(function() {
  'use strict';

  const COMMAND_TYPE = 'AI_CHROME_REMOTE_COMMAND';
  const RESPONSE_TYPE = 'AI_CHROME_REMOTE_RESPONSE';
  const LOG_ENTRY_TYPE = 'AI_CHROME_REMOTE_LOG_ENTRY';
  const REMOTE_MESSAGE_ACTION = 'aiChromeRemoteCommand';
  const injectedScripts = new Set<string>();

  type SiteConfig = {
    id: string;
    name?: string;
    matches: string[];
    adapterScript?: string;
  };

  function postBackgroundLog(level: string, message: string, details: Record<string, unknown> = {}): void {
    chrome.runtime.sendMessage({
      action: 'aiChromeRemoteLogEntry',
      entry: {
        timestamp: new Date().toISOString(),
        level,
        message,
        source: 'content-router',
        url: location.href,
        ...details
      }
    }).catch(() => {});
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
    const response = await fetch(chrome.runtime.getURL('sites/registry.json'));
    const value = await response.json();
    return Array.isArray(value.sites) ? value.sites as SiteConfig[] : [];
  }

  function injectScript(relativePath: string): Promise<void> {
    if (injectedScripts.has(relativePath)) return Promise.resolve();
    injectedScripts.add(relativePath);

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(relativePath);
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = () => {
        script.remove();
        injectedScripts.delete(relativePath);
        reject(new Error(`Failed to inject ${relativePath}`));
      };
      (document.documentElement || document.head || document.body).appendChild(script);
    });
  }

  async function injectPageRuntime(): Promise<void> {
    await injectScript('src/page/page-agent.js');
    const sites = await loadSiteRegistry();
    const matchingSites = sites.filter(site => site.matches.some(pattern => matchesPattern(location.href, pattern)));
    for (const site of matchingSites) {
      if (site.adapterScript) {
        await injectScript(site.adapterScript);
      }
    }
    postBackgroundLog('info', 'Injected page runtime.', {
      matchingSites: matchingSites.map(site => site.id)
    });
  }

  function sendPageCommand(command: string, payload: Record<string, unknown> = {}, timeoutMs = 30000): Promise<unknown> {
    const requestId = `content_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error(`Page command timed out: ${command}`));
      }, timeoutMs);

      function onMessage(event: MessageEvent): void {
        if (event.source !== window) return;
        if (event.data?.type !== RESPONSE_TYPE || event.data?.requestId !== requestId) return;
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        if (!event.data.ok) {
          const error = new Error(event.data.error || 'Page command failed') as Error & { code?: string; details?: Record<string, unknown> };
          error.code = event.data.code || 'page_command_failed';
          error.details = event.data.details || {};
          reject(error);
          return;
        }
        resolve(event.data.result);
      }

      window.addEventListener('message', onMessage);
      window.postMessage({
        type: COMMAND_TYPE,
        requestId,
        command,
        payload
      }, '*');
    });
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    if (event.data?.type !== LOG_ENTRY_TYPE) return;
    chrome.runtime.sendMessage({
      action: 'aiChromeRemoteLogEntry',
      entry: event.data.entry
    }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action !== REMOTE_MESSAGE_ACTION) return false;

    void injectPageRuntime()
      .then(() => sendPageCommand(String(message.command || ''), message.payload || {}, Number(message.payload?.timeoutMs || 30000)))
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: (error as Error & { code?: string }).code || 'content_router_error',
        details: (error as Error & { details?: Record<string, unknown> }).details || {}
      }));
    return true;
  });

  void injectPageRuntime().catch(error => {
    postBackgroundLog('warn', 'Initial page runtime injection failed.', {
      error: error instanceof Error ? error.message : String(error)
    });
  });
})();
