(function() {
  'use strict';

  function extractLinks() {
    return {
      links: Array.from(document.querySelectorAll('a[href]')).slice(0, 50).map(link => ({
        text: link.textContent.trim().slice(0, 200),
        href: link.href
      }))
    };
  }

  function summarizePage() {
    return {
      title: document.title,
      url: location.href,
      h1: document.querySelector('h1')?.textContent?.trim() || null,
      textPreview: document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 1000) || ''
    };
  }

  window.AiChromeRemote?.registerAdapter({
    id: 'example',
    matches: ['https://example.com/*'],
    actions: {
      extractLinks,
      summarizePage
    }
  });
})();
