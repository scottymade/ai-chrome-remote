(function() {
  'use strict';

  const GLOBAL_KEY = '__AiChromeRemoteNetworkRecorder';
  const MAX_ENTRIES = 1000;
  const MAX_PREVIEW_CHARS = 12000;
  const SECRET_KEY_PATTERN = /(authorization|cookie|token|secret|password|api[-_]?key|session)/i;
  const win = window as unknown as Record<string, any>;
  if (win[GLOBAL_KEY]) return;

  type NetworkEntry = {
    id: number;
    timestamp: string;
    type: 'fetch' | 'xhr';
    method: string;
    url: string;
    status?: number;
    ok?: boolean;
    durationMs: number;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
    responseJsonPreview?: unknown;
    responseTextPreview?: string;
    error?: string;
  };

  let nextId = 1;
  let dropped = 0;
  const entries: NetworkEntry[] = [];

  function redactRecord(record: Record<string, string>): Record<string, string> {
    const output: Record<string, string> = {};
    Object.entries(record).forEach(([key, value]) => {
      output[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : String(value).slice(0, 500);
    });
    return output;
  }

  function headersToRecord(headers: Headers | undefined): Record<string, string> {
    const output: Record<string, string> = {};
    if (!headers) return output;
    headers.forEach((value, key) => {
      output[key] = value;
    });
    return redactRecord(output);
  }

  function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Record<string, string> {
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    return headersToRecord(headers);
  }

  function previewValue(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    try {
      const text = JSON.stringify(value);
      if (text.length <= MAX_PREVIEW_CHARS) return value;
      return {
        truncated: true,
        chars: text.length,
        preview: text.slice(0, MAX_PREVIEW_CHARS)
      };
    } catch {
      return '[unserializable]';
    }
  }

  async function responsePreview(response: Response): Promise<Pick<NetworkEntry, 'responseJsonPreview' | 'responseTextPreview'>> {
    const contentType = response.headers.get('content-type') || '';
    const clone = response.clone();
    try {
      if (contentType.includes('json')) {
        return { responseJsonPreview: previewValue(await clone.json()) };
      }
      if (contentType.includes('text') || contentType.includes('html')) {
        const text = await clone.text();
        return { responseTextPreview: text.slice(0, MAX_PREVIEW_CHARS) };
      }
    } catch (error) {
      return { responseTextPreview: `Preview failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    return {};
  }

  function push(entry: NetworkEntry): void {
    entries.push(entry);
    while (entries.length > MAX_ENTRIES) {
      entries.shift();
      dropped++;
    }
  }

  function getEntries(query: Record<string, any> = {}) {
    const limit = Math.max(1, Math.min(Number(query.limit || 200), MAX_ENTRIES));
    const sinceId = Number(query.sinceId || 0);
    const search = query.search ? String(query.search).toLowerCase() : '';
    const type = query.type ? String(query.type).toLowerCase() : '';
    const newestFirst = query.newestFirst === true;

    let results = entries.filter(entry => {
      if (sinceId && entry.id <= sinceId) return false;
      if (type && entry.type !== type) return false;
      if (search && !entry.url.toLowerCase().includes(search)) return false;
      return true;
    });
    results = newestFirst ? results.slice(-limit).reverse() : results.slice(-limit);

    return {
      entries: results,
      total: entries.length,
      dropped,
      nextId
    };
  }

  function clearEntries() {
    const cleared = entries.length;
    entries.length = 0;
    dropped = 0;
    return { cleared, nextId };
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const startedAt = performance.now();
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    const url = input instanceof Request ? input.url : String(input);

    return originalFetch(input, init).then(async response => {
      const preview = await responsePreview(response);
      push({
        id: nextId++,
        timestamp: new Date().toISOString(),
        type: 'fetch',
        method: String(method).toUpperCase(),
        url,
        status: response.status,
        ok: response.ok,
        durationMs: Math.round(performance.now() - startedAt),
        requestHeaders: requestHeaders(input, init),
        responseHeaders: headersToRecord(response.headers),
        ...preview
      });
      return response;
    }).catch(error => {
      push({
        id: nextId++,
        timestamp: new Date().toISOString(),
        type: 'fetch',
        method: String(method).toUpperCase(),
        url,
        durationMs: Math.round(performance.now() - startedAt),
        requestHeaders: requestHeaders(input, init),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    });
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: any[]) {
    (this as any).__aiChromeRemoteRequest = {
      method: String(method || 'GET').toUpperCase(),
      url: String(url)
    };
    return originalOpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function(...args: any[]) {
    const xhr = this;
    const meta = (xhr as any).__aiChromeRemoteRequest || { method: 'GET', url: '' };
    const startedAt = performance.now();
    xhr.addEventListener('loadend', () => {
      const contentType = xhr.getResponseHeader('content-type') || '';
      const entry: NetworkEntry = {
        id: nextId++,
        timestamp: new Date().toISOString(),
        type: 'xhr',
        method: meta.method,
        url: meta.url,
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 300,
        durationMs: Math.round(performance.now() - startedAt),
        responseHeaders: {}
      };
      if (contentType.includes('json')) {
        try {
          entry.responseJsonPreview = previewValue(JSON.parse(String(xhr.responseText || 'null')));
        } catch {
          try {
            entry.responseTextPreview = String(xhr.responseText || '').slice(0, MAX_PREVIEW_CHARS);
          } catch (error) {
            entry.error = `XHR preview failed: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
      } else if (contentType.includes('text') || contentType.includes('html')) {
        try {
          entry.responseTextPreview = String(xhr.responseText || '').slice(0, MAX_PREVIEW_CHARS);
        } catch (error) {
          entry.error = `XHR preview failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      push(entry);
    });
    return originalSend.apply(this, args as any);
  };

  win[GLOBAL_KEY] = {
    getEntries,
    clearEntries
  };
})();
