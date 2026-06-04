export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CommandEnvelope {
  command: string;
  payload?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface SuccessEnvelope<T = unknown> {
  ok: true;
  result: T;
}

export interface ErrorEnvelope {
  ok: false;
  error: string;
  code: string;
  details: Record<string, unknown>;
}

export type ResponseEnvelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

export interface HostMetadata {
  host: '127.0.0.1';
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
}

export const HOST_NAME = 'com.scottymade.ai_chrome_remote';
export const HOST_DIR_NAME = '.ai-chrome-remote';
export const SERVER_NAME = 'ai-chrome-remote';

export const TOOL_MAP = new Map<string, string>([
  ['chrome_remote_host_status', 'host_status'],
  ['chrome_remote_open_url', 'open_url'],
  ['chrome_remote_tab_status', 'tab_status'],
  ['chrome_remote_get_logs', 'get_logs'],
  ['chrome_remote_clear_logs', 'clear_logs'],
  ['chrome_remote_set_logging', 'set_logging'],
  ['chrome_remote_get_network_entries', 'get_network_entries'],
  ['chrome_remote_clear_network_entries', 'clear_network_entries'],
  ['chrome_remote_scroll', 'scroll'],
  ['chrome_remote_click', 'click'],
  ['chrome_remote_type', 'type'],
  ['chrome_remote_get_dom_snapshot', 'get_dom_snapshot'],
  ['chrome_remote_capture_screenshot', 'capture_screenshot'],
  ['chrome_remote_start_job', 'start_job'],
  ['chrome_remote_get_job', 'get_job'],
  ['chrome_remote_cancel_job', 'cancel_job'],
  ['chrome_remote_list_jobs', 'list_jobs'],
  ['chrome_remote_run_adapter_action', 'run_adapter_action']
]);

export function inputSchema(properties: Record<string, unknown> = {}, required: string[] = []) {
  return {
    type: 'object' as const,
    properties,
    required,
    additionalProperties: true
  };
}

export const MCP_TOOLS: ToolDefinition[] = [
  {
    name: 'chrome_remote_host_status',
    description: 'Check the local native host and Chrome extension bridge.',
    inputSchema: inputSchema()
  },
  {
    name: 'chrome_remote_open_url',
    description: 'Open an allowlisted URL in Chrome, creating or reusing a tab.',
    inputSchema: inputSchema({
      url: { type: 'string' },
      tabId: { type: 'number' },
      active: { type: 'boolean' }
    }, ['url'])
  },
  {
    name: 'chrome_remote_tab_status',
    description: 'Inspect the active or specified tab and page agent readiness.',
    inputSchema: inputSchema({ tabId: { type: 'number' }, timeoutMs: { type: 'number' } })
  },
  {
    name: 'chrome_remote_get_logs',
    description: 'Read internal agent, adapter, router, and optional page-console logs.',
    inputSchema: inputSchema({
      tabId: { type: 'number' },
      limit: { type: 'number' },
      level: { type: 'string' },
      levels: { type: 'array', items: { type: 'string' } },
      sinceId: { type: 'number' },
      search: { type: 'string' },
      newestFirst: { type: 'boolean' }
    })
  },
  {
    name: 'chrome_remote_clear_logs',
    description: 'Clear internal logs in the page and background service worker.',
    inputSchema: inputSchema({ tabId: { type: 'number' } })
  },
  {
    name: 'chrome_remote_set_logging',
    description: 'Configure page log capture and console passthrough.',
    inputSchema: inputSchema({
      tabId: { type: 'number' },
      capturePageConsole: { type: 'boolean' },
      consolePassthrough: { type: 'boolean' },
      captureStack: { type: 'boolean' },
      maxEntries: { type: 'number' }
    })
  },
  {
    name: 'chrome_remote_get_network_entries',
    description: 'Read captured fetch/XMLHttpRequest metadata and bounded JSON response previews.',
    inputSchema: inputSchema({
      tabId: { type: 'number' },
      limit: { type: 'number' },
      sinceId: { type: 'number' },
      search: { type: 'string' },
      type: { type: 'string' },
      newestFirst: { type: 'boolean' }
    })
  },
  {
    name: 'chrome_remote_clear_network_entries',
    description: 'Clear the page network recorder ring buffer.',
    inputSchema: inputSchema({ tabId: { type: 'number' } })
  },
  {
    name: 'chrome_remote_scroll',
    description: 'Scroll the page by a pixel amount or to a specific position.',
    inputSchema: inputSchema({
      tabId: { type: 'number' },
      x: { type: 'number' },
      y: { type: 'number' },
      amount: { type: 'number' },
      behavior: { type: 'string' },
      delayMs: { type: 'number' }
    })
  },
  {
    name: 'chrome_remote_click',
    description: 'Click an element by CSS selector or visible text.',
    inputSchema: inputSchema({
      tabId: { type: 'number' },
      selector: { type: 'string' },
      text: { type: 'string' },
      exact: { type: 'boolean' },
      index: { type: 'number' }
    })
  },
  {
    name: 'chrome_remote_type',
    description: 'Type into an input-like element by CSS selector or visible text.',
    inputSchema: inputSchema({
      tabId: { type: 'number' },
      selector: { type: 'string' },
      text: { type: 'string' },
      clear: { type: 'boolean' },
      pressEnter: { type: 'boolean' }
    }, ['text'])
  },
  {
    name: 'chrome_remote_get_dom_snapshot',
    description: 'Return a compact snapshot of visible text and interactive elements.',
    inputSchema: inputSchema({
      tabId: { type: 'number' },
      textMaxChars: { type: 'number' },
      elementLimit: { type: 'number' }
    })
  },
  {
    name: 'chrome_remote_capture_screenshot',
    description: 'Capture the visible tab as a data URL image.',
    inputSchema: inputSchema({
      tabId: { type: 'number' },
      format: { type: 'string' },
      quality: { type: 'number' }
    })
  },
  {
    name: 'chrome_remote_start_job',
    description: 'Run a supported command asynchronously and poll it with get_job.',
    inputSchema: inputSchema({
      command: { type: 'string' },
      payload: { type: 'object' },
      timeoutMs: { type: 'number' }
    }, ['command'])
  },
  {
    name: 'chrome_remote_get_job',
    description: 'Read a background job by id.',
    inputSchema: inputSchema({ jobId: { type: 'string' } }, ['jobId'])
  },
  {
    name: 'chrome_remote_cancel_job',
    description: 'Mark a background job as cancelled.',
    inputSchema: inputSchema({ jobId: { type: 'string' } }, ['jobId'])
  },
  {
    name: 'chrome_remote_list_jobs',
    description: 'List recent background jobs.',
    inputSchema: inputSchema({ limit: { type: 'number' } })
  },
  {
    name: 'chrome_remote_run_adapter_action',
    description: 'Invoke a registered site adapter action by id.',
    inputSchema: inputSchema({
      tabId: { type: 'number' },
      adapterId: { type: 'string' },
      action: { type: 'string' },
      input: { type: 'object' }
    }, ['action'])
  }
];
