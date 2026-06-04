(function() {
  'use strict';

  const NATIVE_HOST_NAME = 'com.scottymade.ai_chrome_remote';
  const TAB_GROUP_TITLE = 'AI remote control';
  const TAB_GROUP_COLOR = 'cyan' as chrome.tabGroups.ColorEnum;
  const BACKGROUND_LOG_MAX = 1000;
  const REMOTE_MESSAGE_ACTION = 'aiChromeRemoteCommand';

  type ErrorResponse = { ok: false; error: string; code: string; details: Record<string, unknown> };
  type ResponseEnvelope = { ok: true; result: unknown } | ErrorResponse;
  type SiteConfig = {
    id: string;
    name?: string;
    matches: string[];
    adapterScript?: string;
  };
  type AgentJob = {
    id: string;
    command: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    createdAt: string;
    updatedAt: string;
    input: Record<string, unknown>;
    result?: unknown;
    error?: { message: string; code: string; details: Record<string, unknown> };
  };

  let nativePort: chrome.runtime.Port | null = null;
  let nativeConnectAttempted = false;
  let nativeReady = false;
  let siteRegistryPromise: Promise<SiteConfig[]> | null = null;
  let aiTabGroupId: number | null = null;
  let nextBackgroundLogId = 1;
  let droppedBackgroundLogs = 0;
  const backgroundLogs: Array<Record<string, unknown>> = [];
  const jobs = new Map<string, AgentJob>();

  function ok(result: unknown): ResponseEnvelope {
    return { ok: true, result };
  }

  function errorEnvelope(error: unknown, fallbackCode = 'agent_command_failed'): ErrorResponse {
    const known = error as Error & { code?: string; details?: Record<string, unknown> };
    return {
      ok: false,
      error: known?.message || String(error || 'Agent command failed'),
      code: known?.code || fallbackCode,
      details: known?.details || {}
    };
  }

  function makeError(message: string, code: string, details: Record<string, unknown> = {}): Error {
    const error = new Error(message) as Error & { code?: string; details?: Record<string, unknown> };
    error.code = code;
    error.details = details;
    return error;
  }

  function pushBackgroundLog(level: string, message: string, details: Record<string, unknown> = {}): void {
    const entry = {
      id: nextBackgroundLogId++,
      timestamp: new Date().toISOString(),
      level,
      message,
      source: 'background',
      ...details
    };
    backgroundLogs.push(entry);
    while (backgroundLogs.length > BACKGROUND_LOG_MAX) {
      backgroundLogs.shift();
      droppedBackgroundLogs++;
    }
  }

  function getBackgroundLogs(query: Record<string, unknown> = {}) {
    const limit = Math.max(1, Math.min(Number(query.limit || 200), BACKGROUND_LOG_MAX));
    const sinceId = Number(query.sinceId || 0);
    const search = typeof query.search === 'string' ? query.search.toLowerCase() : '';
    const newestFirst = query.newestFirst === true;
    const levels = new Set(
      (Array.isArray(query.levels) ? query.levels : query.level ? [query.level] : [])
        .map(level => String(level).toLowerCase())
    );

    let entries = backgroundLogs.filter(entry => {
      if (sinceId && Number(entry.id) <= sinceId) return false;
      if (levels.size && !levels.has(String(entry.level).toLowerCase())) return false;
      if (search && !String(entry.message || '').toLowerCase().includes(search)) return false;
      return true;
    });
    entries = newestFirst ? entries.slice(-limit).reverse() : entries.slice(-limit);

    return {
      entries,
      total: backgroundLogs.length,
      dropped: droppedBackgroundLogs,
      nextId: nextBackgroundLogId
    };
  }

  function patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
  }

  function matchesPattern(url: string, pattern: string): boolean {
    return patternToRegex(pattern).test(url);
  }

  async function loadSiteRegistry(): Promise<SiteConfig[]> {
    if (!siteRegistryPromise) {
      siteRegistryPromise = fetch(chrome.runtime.getURL('sites/registry.json'))
        .then(response => response.json())
        .then(value => Array.isArray(value.sites) ? value.sites as SiteConfig[] : []);
    }
    return siteRegistryPromise;
  }

  async function assertAllowedUrl(url: string): Promise<SiteConfig[]> {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw makeError('Only http and https URLs are supported.', 'unsupported_url', { url });
    }
    const sites = await loadSiteRegistry();
    const matches = sites.filter(site => site.matches.some(pattern => matchesPattern(url, pattern)));
    if (!matches.length) {
      throw makeError('URL is not allowlisted. Add a site folder, rebuild, and reload the extension.', 'unsupported_url', { url });
    }
    return matches;
  }

  async function getTargetTab(payload: Record<string, unknown> = {}): Promise<chrome.tabs.Tab> {
    if (typeof payload.tabId === 'number') {
      const tab = await chrome.tabs.get(payload.tabId);
      if (!tab.id) throw makeError('Target tab no longer exists.', 'tab_not_found', { tabId: payload.tabId });
      return tab;
    }

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) throw makeError('No active tab is available.', 'tab_not_found');
    return activeTab;
  }

  async function ensureAiTabGroup(tabId: number): Promise<{ grouped: boolean; groupId?: number; error?: string }> {
    try {
      if (aiTabGroupId !== null) {
        try {
          await chrome.tabGroups.get(aiTabGroupId);
        } catch {
          aiTabGroupId = null;
        }
      }

      const groupOptions: chrome.tabs.GroupOptions = aiTabGroupId === null
        ? { tabIds: [tabId] }
        : { tabIds: [tabId], groupId: aiTabGroupId };
      const groupId = await chrome.tabs.group(groupOptions);
      aiTabGroupId = groupId;
      await chrome.tabGroups.update(groupId, {
        title: TAB_GROUP_TITLE,
        color: TAB_GROUP_COLOR,
        collapsed: false
      });
      return { grouped: true, groupId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushBackgroundLog('warn', 'Could not move tab into AI remote control group.', { tabId, error: message });
      return { grouped: false, error: message };
    }
  }

  async function commandTab(command: string, payload: Record<string, unknown> = {}, timeoutMs = 30000): Promise<unknown> {
    const tab = await getTargetTab(payload);
    if (!tab.id) throw makeError('Target tab has no id.', 'tab_not_found');
    if (tab.url) await assertAllowedUrl(tab.url);
    await ensureAiTabGroup(tab.id);

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(makeError(`Tab command timed out: ${command}`, 'timeout', { tabId: tab.id, command }));
      }, timeoutMs);

      chrome.tabs.sendMessage(tab.id!, {
        action: REMOTE_MESSAGE_ACTION,
        command,
        payload
      }, response => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(makeError(chrome.runtime.lastError.message || 'Tab command failed.', 'tab_command_failed', { tabId: tab.id, command }));
          return;
        }
        if (!response?.ok) {
          reject(makeError(response?.error || 'Tab command failed.', response?.code || 'tab_command_failed', response?.details || {}));
          return;
        }
        resolve(response.result);
      });
    });
  }

  async function openUrl(payload: Record<string, unknown>) {
    const url = typeof payload.url === 'string' ? payload.url : '';
    if (!url) throw makeError('url is required.', 'invalid_request');
    const sites = await assertAllowedUrl(url);
    const active = payload.active !== false;

    let tab: chrome.tabs.Tab | undefined;
    if (typeof payload.tabId === 'number') {
      tab = await chrome.tabs.update(payload.tabId, { url, active });
    } else {
      tab = await chrome.tabs.create({ url, active });
    }
    if (!tab?.id) throw makeError('Chrome did not return a tab id.', 'tab_not_found');
    const group = await ensureAiTabGroup(tab.id);
    pushBackgroundLog('info', 'Opened remote-control URL.', { tabId: tab.id, url });
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      url,
      active,
      group,
      matchedSites: sites.map(site => ({ id: site.id, name: site.name }))
    };
  }

  async function tabStatus(payload: Record<string, unknown>) {
    const tab = await getTargetTab(payload);
    const matchedSites = tab.url ? (await assertAllowedUrl(tab.url)).map(site => ({ id: site.id, name: site.name })) : [];
    let pageAgent: unknown = null;
    try {
      pageAgent = await commandTab('agent_status', { ...payload, tabId: tab.id }, Number(payload.timeoutMs || 5000));
    } catch (error) {
      pageAgent = errorEnvelope(error);
    }
    return {
      tab: {
        id: tab.id,
        windowId: tab.windowId,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        status: tab.status,
        groupId: tab.groupId
      },
      matchedSites,
      nativeReady,
      pageAgent
    };
  }

  async function captureScreenshot(payload: Record<string, unknown>) {
    const tab = await getTargetTab(payload);
    if (!tab.id) throw makeError('Target tab has no id.', 'tab_not_found');
    if (tab.url) await assertAllowedUrl(tab.url);
    await ensureAiTabGroup(tab.id);

    if (!tab.active && payload.activate !== true) {
      throw makeError('Chrome can only capture the visible active tab. Pass activate:true to activate this tab before capture.', 'active_tab_required', { tabId: tab.id });
    }
    if (!tab.active && payload.activate === true) {
      await chrome.tabs.update(tab.id, { active: true });
    }

    const format = payload.format === 'jpeg' ? 'jpeg' : 'png';
    const quality = typeof payload.quality === 'number'
      ? Math.max(0, Math.min(100, Math.round(payload.quality)))
      : undefined;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format, quality });
    return {
      tabId: tab.id,
      format,
      dataUrl,
      byteLength: Math.ceil(dataUrl.length * 0.75)
    };
  }

  function createJob(command: string, input: Record<string, unknown>): AgentJob {
    const now = new Date().toISOString();
    const job: AgentJob = {
      id: `job_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      command,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      input
    };
    jobs.set(job.id, job);
    return job;
  }

  function serializeJob(job: AgentJob) {
    return { ...job };
  }

  function isJobCancelled(jobId: string): boolean {
    return jobs.get(jobId)?.status === 'cancelled';
  }

  function startJob(payload: Record<string, unknown>) {
    const command = typeof payload.command === 'string' ? payload.command : '';
    if (!command) throw makeError('command is required.', 'invalid_request');
    if (['start_job', 'get_job', 'cancel_job', 'list_jobs'].includes(command)) {
      throw makeError('Job commands cannot be nested.', 'invalid_request', { command });
    }
    const nestedPayload = typeof payload.payload === 'object' && payload.payload !== null
      ? payload.payload as Record<string, unknown>
      : {};
    const job = createJob(command, nestedPayload);

    void (async () => {
      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      try {
        const result = await handleAgentCommand(command, nestedPayload);
        if (!isJobCancelled(job.id)) {
          job.status = 'completed';
          job.result = result;
          job.updatedAt = new Date().toISOString();
        }
      } catch (error) {
        if (!isJobCancelled(job.id)) {
          const envelope = errorEnvelope(error);
          job.status = 'failed';
          job.error = { message: envelope.error, code: envelope.code, details: envelope.details };
          job.updatedAt = new Date().toISOString();
        }
      }
    })();

    return serializeJob(job);
  }

  function getJob(payload: Record<string, unknown>) {
    const jobId = typeof payload.jobId === 'string' ? payload.jobId : '';
    const job = jobs.get(jobId);
    if (!job) throw makeError('Job not found.', 'job_not_found', { jobId });
    return serializeJob(job);
  }

  function cancelJob(payload: Record<string, unknown>) {
    const jobId = typeof payload.jobId === 'string' ? payload.jobId : '';
    const job = jobs.get(jobId);
    if (!job) throw makeError('Job not found.', 'job_not_found', { jobId });
    job.status = 'cancelled';
    job.updatedAt = new Date().toISOString();
    return serializeJob(job);
  }

  function listJobs(payload: Record<string, unknown>) {
    const limit = Math.max(1, Math.min(Number(payload.limit || 50), 200));
    return {
      jobs: Array.from(jobs.values())
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(serializeJob)
    };
  }

  async function handleAgentCommand(command: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    switch (command) {
      case 'host_status':
        return {
          nativeReady,
          nativeHostName: NATIVE_HOST_NAME,
          tabGroupTitle: TAB_GROUP_TITLE,
          aiTabGroupId,
          sites: (await loadSiteRegistry()).map(site => ({ id: site.id, name: site.name, matches: site.matches }))
        };
      case 'open_url':
        return openUrl(payload);
      case 'tab_status':
        return tabStatus(payload);
      case 'capture_screenshot':
        return captureScreenshot(payload);
      case 'start_job':
        return startJob(payload);
      case 'get_job':
        return getJob(payload);
      case 'cancel_job':
        return cancelJob(payload);
      case 'list_jobs':
        return listJobs(payload);
      case 'get_background_logs':
        return getBackgroundLogs(payload);
      case 'clear_background_logs': {
        const cleared = backgroundLogs.length;
        backgroundLogs.length = 0;
        droppedBackgroundLogs = 0;
        return { cleared, nextId: nextBackgroundLogId };
      }
      default:
        return commandTab(command, payload, Number(payload.timeoutMs || 30000));
    }
  }

  function connectNativeHost(): void {
    if (nativePort || nativeConnectAttempted) return;
    nativeConnectAttempted = true;

    try {
      nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      nativePort.onMessage.addListener(async message => {
        if (message?.type === 'host_ready') {
          nativeReady = true;
          pushBackgroundLog('info', 'Native host ready.', { result: message.result });
          return;
        }
        if (message?.type === 'host_error') {
          pushBackgroundLog('warn', 'Native host reported an error.', { message });
          return;
        }
        if (message?.type !== 'agent_request') return;

        try {
          const result = await handleAgentCommand(String(message.command || ''), message.payload || {});
          nativePort?.postMessage({
            type: 'agent_response',
            id: message.id,
            ...ok(result)
          });
        } catch (error) {
          nativePort?.postMessage({
            type: 'agent_response',
            id: message.id,
            ...errorEnvelope(error)
          });
        }
      });

      nativePort.onDisconnect.addListener(() => {
        const message = chrome.runtime.lastError?.message || 'Native host disconnected.';
        pushBackgroundLog('warn', message);
        nativePort = null;
        nativeReady = false;
        setTimeout(() => {
          nativeConnectAttempted = false;
          connectNativeHost();
        }, 5000);
      });
    } catch (error) {
      pushBackgroundLog('warn', 'Native host unavailable.', { error: error instanceof Error ? error.message : String(error) });
      nativePort = null;
      nativeReady = false;
      setTimeout(() => {
        nativeConnectAttempted = false;
        connectNativeHost();
      }, 5000);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === 'aiChromeRemoteLogEntry') {
      pushBackgroundLog(String(message.entry?.level || 'log'), String(message.entry?.message || ''), {
        ...message.entry,
        tabId: sender.tab?.id
      });
      sendResponse({ ok: true });
      return false;
    }

    if (message?.action === 'aiChromeRemoteCommand') {
      void handleAgentCommand(String(message.command || ''), message.payload || {})
        .then(result => sendResponse(ok(result)))
        .catch(error => sendResponse(errorEnvelope(error)));
      return true;
    }

    return false;
  });

  chrome.runtime.onInstalled.addListener(() => {
    void loadSiteRegistry();
    connectNativeHost();
  });
  chrome.runtime.onStartup.addListener(connectNativeHost);
  setTimeout(connectNativeHost, 1000);
  pushBackgroundLog('info', 'AI Chrome Remote service worker ready.');
})();
