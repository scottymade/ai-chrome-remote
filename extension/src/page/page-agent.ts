(function() {
  'use strict';

  const COMMAND_TYPE = 'AI_CHROME_REMOTE_COMMAND';
  const RESPONSE_TYPE = 'AI_CHROME_REMOTE_RESPONSE';
  const LOG_ENTRY_TYPE = 'AI_CHROME_REMOTE_LOG_ENTRY';
  const GLOBAL_KEY = 'AiChromeRemote';
  const RECORDER_KEY = '__AiChromeRemoteNetworkRecorder';
  const LOG_MAX_DEFAULT = 1000;
  const win = window as unknown as Record<string, any>;
  if (win[GLOBAL_KEY]?.ready) return;

  type LogEntry = {
    id: number;
    timestamp: string;
    level: string;
    message: string;
    args?: unknown[];
    stack?: string | null;
    source: string;
    url: string;
  };
  type Adapter = {
    id: string;
    matches?: string[];
    actions?: Record<string, (input?: Record<string, unknown>) => unknown | Promise<unknown>>;
  };

  let nextLogId = 1;
  let droppedLogs = 0;
  const logs: LogEntry[] = [];
  const adapters = new Map<string, Adapter>();
  const loggingOptions = {
    capturePageConsole: false,
    consolePassthrough: false,
    captureStack: true,
    maxEntries: LOG_MAX_DEFAULT
  };
  const originalConsole: Record<string, (...args: any[]) => void> = {};
  const levels = ['debug', 'log', 'info', 'warn', 'error'];

  levels.forEach(level => {
    originalConsole[level] = typeof console[level as keyof Console] === 'function'
      ? (console[level as keyof Console] as (...args: any[]) => void).bind(console)
      : console.log.bind(console);
  });

  function truncate(text: string, max = 5000): string {
    return text.length <= max ? text : `${text.slice(0, max)}... [truncated ${text.length - max} chars]`;
  }

  function serialize(value: unknown, seen = new WeakSet<object>()): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return truncate(value, 2000);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 25).map(item => serialize(item, seen));
    const output: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).slice(0, 50).forEach(([key, item]) => {
      output[key] = serialize(item, seen);
    });
    return output;
  }

  function stringify(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(serialize(value));
    } catch {
      return String(value);
    }
  }

  function stack(): string | null {
    if (!loggingOptions.captureStack) return null;
    return (new Error().stack || '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.includes('page-agent.js'))
      .slice(0, 20)
      .join('\n') || null;
  }

  function pushLog(level: string, args: unknown[], source = 'page-agent', force = false): LogEntry | null {
    if (!force && source === 'page-console' && !loggingOptions.capturePageConsole) return null;
    const entry: LogEntry = {
      id: nextLogId++,
      timestamp: new Date().toISOString(),
      level,
      message: truncate(args.map(stringify).join(' ')),
      args: args.map(arg => serialize(arg)),
      stack: stack(),
      source,
      url: location.href
    };
    logs.push(entry);
    while (logs.length > loggingOptions.maxEntries) {
      logs.shift();
      droppedLogs++;
    }
    window.postMessage({ type: LOG_ENTRY_TYPE, entry }, '*');
    return entry;
  }

  function wrapConsole(): void {
    levels.forEach(level => {
      (console as any)[level] = (...args: any[]) => {
        pushLog(level, args, 'page-console');
        if (loggingOptions.consolePassthrough) originalConsole[level]?.(...args);
      };
    });
  }

  function setLogging(payload: Record<string, any> = {}) {
    if (typeof payload.capturePageConsole === 'boolean') loggingOptions.capturePageConsole = payload.capturePageConsole;
    if (typeof payload.consolePassthrough === 'boolean') loggingOptions.consolePassthrough = payload.consolePassthrough;
    if (typeof payload.captureStack === 'boolean') loggingOptions.captureStack = payload.captureStack;
    if (typeof payload.maxEntries === 'number') loggingOptions.maxEntries = Math.max(100, Math.min(5000, Math.round(payload.maxEntries)));
    wrapConsole();
    pushLog('info', ['Logging configured', loggingOptions], 'page-agent', true);
    return getLoggingState();
  }

  function getLoggingState() {
    return {
      options: { ...loggingOptions },
      total: logs.length,
      dropped: droppedLogs,
      nextId: nextLogId
    };
  }

  function getLogs(query: Record<string, any> = {}) {
    const limit = Math.max(1, Math.min(Number(query.limit || 200), loggingOptions.maxEntries));
    const sinceId = Number(query.sinceId || 0);
    const search = query.search ? String(query.search).toLowerCase() : '';
    const newestFirst = query.newestFirst === true;
    const levelSet = new Set(
      (Array.isArray(query.levels) ? query.levels : query.level ? [query.level] : [])
        .map((level: unknown) => String(level).toLowerCase())
    );
    let entries = logs.filter(entry => {
      if (sinceId && entry.id <= sinceId) return false;
      if (levelSet.size && !levelSet.has(entry.level)) return false;
      if (search && !entry.message.toLowerCase().includes(search)) return false;
      return true;
    });
    entries = newestFirst ? entries.slice(-limit).reverse() : entries.slice(-limit);
    return { entries, total: logs.length, dropped: droppedLogs, nextId: nextLogId, options: { ...loggingOptions } };
  }

  function clearLogs() {
    const cleared = logs.length;
    logs.length = 0;
    droppedLogs = 0;
    return { cleared, nextId: nextLogId };
  }

  function recorder() {
    return win[RECORDER_KEY] as { getEntries?: (query?: Record<string, unknown>) => unknown; clearEntries?: () => unknown } | undefined;
  }

  function visibleText(element: Element): string {
    return (element.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function elementDescriptor(element: Element, index: number) {
    const rect = element.getBoundingClientRect();
    return {
      index,
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: Array.from(element.classList).slice(0, 8),
      name: (element as HTMLInputElement).name || null,
      role: element.getAttribute('role'),
      ariaLabel: element.getAttribute('aria-label'),
      text: visibleText(element).slice(0, 240),
      href: element instanceof HTMLAnchorElement ? element.href : null,
      placeholder: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.placeholder : null,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  function getDomSnapshot(payload: Record<string, any> = {}) {
    const textMaxChars = Math.max(500, Math.min(Number(payload.textMaxChars || 5000), 50000));
    const elementLimit = Math.max(1, Math.min(Number(payload.elementLimit || 100), 500));
    const selectors = [
      'a[href]',
      'button',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[contenteditable="true"]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    const elements = Array.from(document.querySelectorAll(selectors))
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .slice(0, elementLimit)
      .map(elementDescriptor);

    return {
      url: location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY },
      text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, textMaxChars),
      elements
    };
  }

  function findByText(text: string, exact = false, index = 0): Element | null {
    const needle = text.toLowerCase();
    const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,[role="button"],[role="link"],[contenteditable="true"],[tabindex]'))
      .filter(element => {
        const value = [
          visibleText(element),
          element.getAttribute('aria-label') || '',
          element.getAttribute('placeholder') || '',
          element instanceof HTMLInputElement ? element.value : ''
        ].join(' ').trim().toLowerCase();
        return exact ? value === needle : value.includes(needle);
      });
    return candidates[index] || null;
  }

  function targetElement(payload: Record<string, any>): Element {
    let element: Element | null = null;
    if (typeof payload.selector === 'string' && payload.selector) {
      const candidates = Array.from(document.querySelectorAll(payload.selector));
      element = candidates[Math.max(0, Number(payload.index || 0))] || null;
    } else if (typeof payload.text === 'string' && payload.text) {
      element = findByText(payload.text, payload.exact === true, Math.max(0, Number(payload.index || 0)));
    }
    if (!element) throw Object.assign(new Error('Target element not found.'), { code: 'element_not_found', details: payload });
    return element;
  }

  async function scrollPage(payload: Record<string, any> = {}) {
    const x = typeof payload.x === 'number' ? payload.x : 0;
    const y = typeof payload.y === 'number' ? payload.y : Number(payload.amount || window.innerHeight * 0.8);
    window.scrollBy({ left: x, top: y, behavior: payload.behavior === 'smooth' ? 'smooth' : 'auto' });
    if (payload.delayMs) await new Promise(resolve => setTimeout(resolve, Math.min(Number(payload.delayMs), 10000)));
    return {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }
    };
  }

  function clickElement(payload: Record<string, any> = {}) {
    const element = targetElement(payload) as HTMLElement;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus?.();
    element.click();
    pushLog('info', ['Clicked element', elementDescriptor(element, 0)], 'page-agent', true);
    return { clicked: elementDescriptor(element, 0), url: location.href };
  }

  function typeText(payload: Record<string, any> = {}) {
    if (typeof payload.text !== 'string') throw Object.assign(new Error('text is required.'), { code: 'invalid_request' });
    const element = targetElement(payload) as HTMLInputElement | HTMLTextAreaElement | HTMLElement;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus?.();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (payload.clear !== false) element.value = '';
      element.value += payload.text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: payload.text }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      if (payload.clear !== false) element.textContent = '';
      element.textContent = `${element.textContent || ''}${payload.text}`;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: payload.text }));
    }
    if (payload.pressEnter === true) {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    return { typed: true, target: elementDescriptor(element, 0), url: location.href };
  }

  function registerAdapter(adapter: Adapter) {
    if (!adapter?.id) throw new Error('Adapter id is required.');
    adapters.set(adapter.id, adapter);
    pushLog('info', [`Registered adapter ${adapter.id}`], 'page-agent', true);
    return { id: adapter.id, actions: Object.keys(adapter.actions || {}) };
  }

  async function runAdapterAction(payload: Record<string, any> = {}) {
    const action = typeof payload.action === 'string' ? payload.action : '';
    if (!action) throw Object.assign(new Error('action is required.'), { code: 'invalid_request' });
    const adapter = payload.adapterId
      ? adapters.get(String(payload.adapterId))
      : Array.from(adapters.values()).find(item => item.actions?.[action]);
    if (!adapter) throw Object.assign(new Error('Adapter not found.'), { code: 'adapter_not_found', details: { adapterId: payload.adapterId } });
    const fn = adapter.actions?.[action];
    if (!fn) throw Object.assign(new Error('Adapter action not found.'), { code: 'adapter_action_not_found', details: { adapterId: adapter.id, action } });
    return {
      adapterId: adapter.id,
      action,
      result: await fn(payload.input || {})
    };
  }

  function agentStatus() {
    return {
      ready: true,
      url: location.href,
      title: document.title,
      adapters: Array.from(adapters.values()).map(adapter => ({
        id: adapter.id,
        actions: Object.keys(adapter.actions || {})
      })),
      logging: getLoggingState(),
      network: recorder()?.getEntries?.({ limit: 1 })
    };
  }

  async function handleCommand(command: string, payload: Record<string, any> = {}): Promise<unknown> {
    switch (command) {
      case 'agent_status':
        return agentStatus();
      case 'set_logging':
        return setLogging(payload);
      case 'get_logs':
        return getLogs(payload);
      case 'clear_logs':
        return clearLogs();
      case 'get_network_entries':
        return recorder()?.getEntries?.(payload) || { entries: [], total: 0, dropped: 0, nextId: 1, unavailable: true };
      case 'clear_network_entries':
        return recorder()?.clearEntries?.() || { cleared: 0, unavailable: true };
      case 'get_dom_snapshot':
        return getDomSnapshot(payload);
      case 'scroll':
        return scrollPage(payload);
      case 'click':
        return clickElement(payload);
      case 'type':
        return typeText(payload);
      case 'run_adapter_action':
        return runAdapterAction(payload);
      default:
        throw Object.assign(new Error(`Unknown page command: ${command}`), { code: 'unknown_command' });
    }
  }

  win[GLOBAL_KEY] = {
    ready: true,
    registerAdapter,
    handleCommand,
    getDomSnapshot,
    getLogs,
    getNetworkEntries: (query: Record<string, unknown>) => recorder()?.getEntries?.(query)
  };

  window.addEventListener('message', async event => {
    if (event.source !== window) return;
    if (event.data?.type !== COMMAND_TYPE) return;
    const { requestId, command, payload } = event.data;
    try {
      window.postMessage({
        type: RESPONSE_TYPE,
        requestId,
        ok: true,
        result: await handleCommand(String(command || ''), payload || {})
      }, '*');
    } catch (error) {
      const known = error as Error & { code?: string; details?: Record<string, unknown> };
      window.postMessage({
        type: RESPONSE_TYPE,
        requestId,
        ok: false,
        error: known.message || String(error),
        code: known.code || 'page_command_failed',
        details: known.details || {}
      }, '*');
    }
  });

  wrapConsole();
  pushLog('info', ['AI Chrome Remote page agent ready'], 'page-agent', true);
})();
