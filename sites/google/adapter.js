(function() {
  'use strict';

  const GOOGLE_COLLECTIONS_KEY = 'aiChromeRemote.google.collections';

  const GOOGLE_HOST_RE = /(^|\.)google\.[a-z.]+$/i;
  const NAV_LABELS = new Set([
    'ai mode',
    'all',
    'news',
    'videos',
    'images',
    'forums',
    'web',
    'short videos',
    'more',
    'tools',
    'settings',
    'privacy',
    'terms',
    'about',
    'store',
    'gmail'
  ]);
  const SITELINK_LABELS = new Set([
    'customers',
    'for enterprises',
    'integrations',
    'pricing',
    'read more',
    'sign up',
    'solutions'
  ]);
  const AD_URL_PARAMS = [
    'gclid',
    'gbraid',
    'wbraid',
    'gad_source',
    'gad_campaignid'
  ];
  const SEARCH_VERTICALS = {
    all: {},
    images: { udm: '2' },
    videos: { udm: '7' },
    forums: { udm: '18' },
    news: { tbm: 'nws', source: 'lnms' },
    shortVideos: { udm: '39' },
    web: { udm: '14' }
  };
  const SEARCH_VERTICAL_ALIASES = {
    all: 'all',
    default: 'all',
    image: 'images',
    images: 'images',
    video: 'videos',
    videos: 'videos',
    forum: 'forums',
    forums: 'forums',
    discussion: 'forums',
    discussions: 'forums',
    news: 'news',
    shortvideo: 'shortVideos',
    shortvideos: 'shortVideos',
    shorts: 'shortVideos',
    web: 'web'
  };
  const UDM_VERTICALS = new Map([
    ['2', 'images'],
    ['7', 'videos'],
    ['14', 'web'],
    ['18', 'forums'],
    ['39', 'shortVideos']
  ]);
  const TBM_VERTICALS = new Map([
    ['isch', 'images'],
    ['vid', 'videos'],
    ['nws', 'news']
  ]);
  const FEATURE_LABELS = new Map([
    ['ai overview', 'aiOverview'],
    ['videos', 'video'],
    ['short videos', 'shortVideo'],
    ['discussions and forums', 'discussion'],
    ['what people are saying', 'discussion'],
    ['top stories', 'news'],
    ['latest news', 'news'],
    ['sponsored results', 'sponsored'],
    ['people also ask', 'question'],
    ['people also search for', 'relatedSearch'],
    ['related searches', 'relatedSearch'],
    ['web results', 'web']
  ]);
  const BUCKET_ALIASES = {
    organic: 'organic',
    sponsored: 'sponsored',
    ad: 'sponsored',
    ads: 'sponsored',
    video: 'video',
    videos: 'video',
    image: 'image',
    images: 'image',
    shortVideo: 'shortVideo',
    shortVideos: 'shortVideo',
    discussion: 'discussion',
    discussions: 'discussion',
    forum: 'discussion',
    forums: 'discussion',
    news: 'news',
    aiOverview: 'aiOverview',
    ai: 'aiOverview',
    other: 'other',
    all: 'all'
  };
  const DATE_RE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2},\s+\d{4}\b/i;
  const RELATIVE_DATE_RE = /\b(?:just now|today|yesterday|\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago)\b/i;
  const DURATION_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;

  function textOf(element) {
    return (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function linesOf(element) {
    return (element?.innerText || element?.textContent || '')
      .split(/\n+/)
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function ownTextOf(element) {
    return Array.from(element?.childNodes || [])
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.nodeValue || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function truncate(text, max) {
    return text.length <= max ? text : `${text.slice(0, max)}...`;
  }

  function uniqueBy(items, keyFn, limit = Infinity) {
    const seen = new Set();
    const output = [];
    for (const item of items) {
      if (!item) continue;
      const key = keyFn(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(item);
      if (output.length >= limit) break;
    }
    return output;
  }

  function elementScreenPosition(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) return { top: null, left: null, width: null, height: null, isInViewport: false };
    return {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      isInViewport: rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth
    };
  }

  function cleanResultUrl(rawHref) {
    try {
      const url = new URL(rawHref, location.href);
      if (GOOGLE_HOST_RE.test(url.hostname) && url.pathname === '/url' && url.searchParams.get('q')) {
        return new URL(url.searchParams.get('q')).href;
      }
      if (GOOGLE_HOST_RE.test(url.hostname) && url.pathname === '/aclk' && url.searchParams.get('adurl')) {
        return new URL(url.searchParams.get('adurl')).href;
      }
      if (GOOGLE_HOST_RE.test(url.hostname) && url.pathname === '/imgres') {
        const imagePageUrl = url.searchParams.get('imgrefurl');
        const imageUrl = url.searchParams.get('imgurl');
        if (imagePageUrl) return new URL(imagePageUrl).href;
        if (imageUrl) return new URL(imageUrl).href;
      }
      return url.href;
    } catch {
      return null;
    }
  }

  function googleImageUrlFromHref(rawHref) {
    try {
      const url = new URL(rawHref, location.href);
      if (!GOOGLE_HOST_RE.test(url.hostname) || url.pathname !== '/imgres') return null;
      const imageUrl = url.searchParams.get('imgurl');
      return imageUrl ? new URL(imageUrl).href : null;
    } catch {
      return null;
    }
  }

  function isGoogleInternalUrl(href) {
    try {
      const url = new URL(href);
      return GOOGLE_HOST_RE.test(url.hostname);
    } catch {
      return true;
    }
  }

  function isLikelyAdUrl(href) {
    try {
      const url = new URL(href);
      return AD_URL_PARAMS.some(param => url.searchParams.has(param)) ||
        url.searchParams.get('utm_medium') === 'paid_search';
    } catch {
      return false;
    }
  }

  function currentQuery() {
    const input = document.querySelector('textarea[name="q"], input[name="q"]');
    if (input && typeof input.value === 'string') return input.value.trim();
    const query = new URL(location.href).searchParams.get('q');
    if (query) return query;
    const mapsMatch = decodeURIComponent(location.pathname).match(/\/maps\/search\/([^/@]+)/i);
    return mapsMatch ? mapsMatch[1].replace(/\+/g, ' ').trim() : '';
  }

  function normalizeSearchVertical(value, fallback = 'all') {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const normalized = String(value).trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    const compact = normalized.replace(/\s+/g, '');
    return SEARCH_VERTICAL_ALIASES[normalized] || SEARCH_VERTICAL_ALIASES[compact] || null;
  }

  function currentVertical() {
    try {
      const url = new URL(location.href);
      const tbm = (url.searchParams.get('tbm') || '').toLowerCase();
      if (tbm && TBM_VERTICALS.has(tbm)) return TBM_VERTICALS.get(tbm);

      const udm = url.searchParams.get('udm') || '';
      if (udm && UDM_VERTICALS.has(udm)) return UDM_VERTICALS.get(udm);
    } catch {
      // Fall back to the default vertical.
    }
    return 'all';
  }

  function applySearchVertical(url, vertical) {
    url.searchParams.delete('udm');
    url.searchParams.delete('tbm');
    url.searchParams.delete('source');

    const config = SEARCH_VERTICALS[vertical] || SEARCH_VERTICALS.all;
    if (config.udm) url.searchParams.set('udm', config.udm);
    if (config.tbm) url.searchParams.set('tbm', config.tbm);
    if (config.source) url.searchParams.set('source', config.source);
  }

  function setOptionalIntegerParam(url, input, name, minimum = 0) {
    if (input[name] === undefined || input[name] === null || input[name] === '') return;
    const value = Number(input[name]);
    if (!Number.isFinite(value) || value < minimum) return;
    url.searchParams.set(name, String(Math.floor(value)));
  }

  function resultStats() {
    return textOf(document.querySelector('#result-stats')) || null;
  }

  function isResultsPage() {
    return location.pathname === '/search' || Boolean(document.querySelector('#search, #rso'));
  }

  function visibleAnchor(anchor) {
    const rect = anchor.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function visibleElement(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function documentY(element) {
    const rect = element.getBoundingClientRect();
    return rect.top + window.scrollY;
  }

  function searchRoot() {
    return document.querySelector('#rcnt') || document.querySelector('#search') || document.body;
  }

  function markerY(predicate) {
    const markers = Array.from(document.querySelectorAll('body *'))
      .filter(element => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const text = textOf(element);
        return text.length > 0 && text.length < 120 && predicate(text);
      })
      .map(documentY);
    return markers.length ? Math.min(...markers) : null;
  }

  function sponsoredBand() {
    const start = markerY(text => /^Sponsored results$/i.test(text) || text.includes('Sponsored results'));
    if (start === null) return null;

    const ends = [
      markerY(text => /^Web results$/i.test(text) || text.includes('Web results')),
      markerY(text => /^Hide sponsored results$/i.test(text) || text.includes('Hide sponsored results'))
    ].filter(value => typeof value === 'number' && value > start);
    return {
      start,
      end: ends.length ? Math.min(...ends) : Infinity
    };
  }

  function featureTypeForText(rawText) {
    const text = rawText.toLowerCase().replace(/\s+/g, ' ').trim();
    if (FEATURE_LABELS.has(text)) return FEATURE_LABELS.get(text);

    const orderedPrefixes = [
      ['short videos', 'shortVideo'],
      ['discussions and forums', 'discussion'],
      ['what people are saying', 'discussion'],
      ['people also search for', 'relatedSearch'],
      ['related searches', 'relatedSearch'],
      ['people also ask', 'question'],
      ['ai overview', 'aiOverview'],
      ['top stories', 'news'],
      ['latest news', 'news'],
      ['sponsored results', 'sponsored'],
      ['web results', 'web'],
      ['videos', 'video']
    ];
    const match = orderedPrefixes.find(([prefix]) => text === prefix || text.startsWith(`${prefix} `));
    return match?.[1] || null;
  }

  function featureMarkers() {
    const root = searchRoot();
    const elementMarkers = Array.from(root.querySelectorAll('*'))
      .map(element => {
        if (!visibleElement(element)) return false;
        if (element.closest('header, nav, [role="navigation"]')) return false;
        const texts = [ownTextOf(element), textOf(element)]
          .map(text => text.replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        const label = texts.find(text => text.length < 600 && featureTypeForText(text));
        if (!label) return null;
        return {
          type: featureTypeForText(label),
          label,
          y: documentY(element)
        };
      })
      .filter(Boolean);

    const textMarkers = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length >= 120 || !featureTypeForText(text)) return NodeFilter.FILTER_REJECT;

        const parent = node.parentElement;
        if (!parent || !visibleElement(parent)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('header, nav, [role="navigation"]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) {
      const label = (walker.currentNode.nodeValue || '').replace(/\s+/g, ' ').trim();
      textMarkers.push({
        type: featureTypeForText(label),
        label,
        y: documentY(walker.currentNode.parentElement)
      });
    }

    const markers = [...elementMarkers, ...textMarkers].sort((a, b) => a.y - b.y);

    return markers.filter((marker, index) => {
      const previous = markers[index - 1];
      return !previous || previous.type !== marker.type || Math.abs(previous.y - marker.y) > 8;
    });
  }

  function featureForY(y, markers) {
    let current = null;
    for (const marker of markers) {
      if (marker.y <= y + 1) current = marker;
      if (marker.y > y + 1) break;
    }
    return current?.type || null;
  }

  function boundsForFeature(markers, type) {
    const start = markers.find(marker => marker.type === type);
    if (!start) return null;

    const end = markers.find(marker => marker.y > start.y + 8)?.y || Infinity;
    return {
      start: start.y,
      end,
      label: start.label
    };
  }

  function isInBand(anchor, band) {
    if (!band) return false;
    const y = documentY(anchor);
    return y >= band.start && y <= band.end;
  }

  function isInSponsoredBand(anchor) {
    return isInBand(anchor, sponsoredBand());
  }

  function isNavLink(anchor, title, href) {
    const lowerTitle = title.toLowerCase();
    if (NAV_LABELS.has(lowerTitle)) return true;
    if (anchor.id === 'logo') return true;
    if (href === location.href || href === '') return true;
    if (anchor.closest('header, nav, [role="navigation"]')) return true;
    return false;
  }

  function isSitelinkTitle(title) {
    const normalized = title.toLowerCase().replace(/\s+/g, ' ').trim();
    return SITELINK_LABELS.has(normalized) || normalized.startsWith('read more');
  }

  function isForumMetadataTitle(title) {
    return /^\d+\s+(?:answers?|comments?|replies?)$/i.test(title) ||
      /^(?:top answer|popular comment):?$/i.test(title);
  }

  function titleFor(anchor) {
    const heading = anchor.querySelector('h3');
    if (heading) return textOf(heading);
    const lines = linesOf(anchor);
    const title = lines.find(line => {
      if (line.length < 3 || line.length > 180) return false;
      if (/^https?:\/\//i.test(line)) return false;
      if (/^[\w.-]+\.[a-z]{2,}/i.test(line)) return false;
      return true;
    });
    return title || titleFromAria(anchor) || textOf(anchor).slice(0, 180);
  }

  function titleFromAria(anchor) {
    const raw = anchor.getAttribute('aria-label') || anchor.getAttribute('title') || '';
    const title = raw
      .replace(/\.\s*Opens in new tab\.?$/i, '')
      .replace(/\s*Opens in new tab\.?$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return title || null;
  }

  function topChildUnder(root, element) {
    let current = element;
    while (current?.parentElement && current.parentElement !== root) {
      current = current.parentElement;
    }
    return current || element;
  }

  function compactResultBlockFor(anchor) {
    const anchorTextLength = textOf(anchor).length;
    let current = anchor.parentElement;
    for (let depth = 0; current && depth < 7; depth++) {
      const text = textOf(current);
      if (
        text.length > 40 &&
        text.length < 1600 &&
        text.length > anchorTextLength + 20 &&
        current.querySelector('h3') &&
        current.querySelectorAll('a[href]').length <= 12
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return anchor;
  }

  function compactFeatureBlockFor(anchor) {
    const anchorTextLength = textOf(anchor).length;
    let current = anchor.parentElement;
    for (let depth = 0; current && depth < 7; depth++) {
      const rect = current.getBoundingClientRect();
      const text = textOf(current);
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        text.length > 8 &&
        text.length < 1400 &&
        text.length >= anchorTextLength &&
        current.querySelectorAll('a[href]').length <= 6 &&
        current.id !== 'search' &&
        current.id !== 'rso'
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return anchor;
  }

  function compactAdBlockFor(anchor) {
    const adRoot = anchor.closest('#tads, #tadsb, #taw, #bottomads, [data-text-ad]');
    if (!adRoot) return null;

    const anchorTextLength = textOf(anchor).length;
    let current = anchor.parentElement;
    for (let depth = 0; current && depth < 8; depth++) {
      const text = textOf(current);
      if (
        text.length > 40 &&
        text.length < 1800 &&
        text.length > anchorTextLength + 20 &&
        current.querySelectorAll('a[href]').length <= 12
      ) {
        return current;
      }
      if (current === adRoot) break;
      current = current.parentElement;
    }

    return topChildUnder(adRoot, anchor);
  }

  function resultBlockFor(anchor, featureType = null) {
    if (featureType && featureType !== 'web') {
      const featureBlock = compactFeatureBlockFor(anchor);
      if (featureBlock) return featureBlock;
    }

    const compactBlock = compactResultBlockFor(anchor);
    if (compactBlock) return compactBlock;

    const adRoot = anchor.closest('#tads, #tadsb, #taw, #bottomads, [data-text-ad]');
    if (adRoot) return compactAdBlockFor(anchor);

    const rso = document.querySelector('#rso');
    if (rso && rso.contains(anchor)) {
      const block = topChildUnder(rso, anchor);
      const text = textOf(block);
      if (text.length < 1800) return block;
    }

    return anchor;
  }

  function displayUrlFor(anchor, href) {
    const cite = anchor.querySelector('cite');
    if (cite) return textOf(cite);
    try {
      const url = new URL(href);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  function hasDisplayedUrl(anchor, href) {
    const text = textOf(anchor).toLowerCase();
    if (/https?:\/\//i.test(text)) return true;
    try {
      const host = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
      return host.length > 0 && text.includes(host);
    } catch {
      return false;
    }
  }

  function descriptionFrom(block, title, displayUrl) {
    const blocked = new Set([
      title,
      displayUrl,
      'ad',
      'ads',
      'sponsored',
      'sponsored results',
      'web results',
      'web result with site links',
      'more results',
      'read more'
    ].filter(Boolean));

    const parts = linesOf(block).filter(line => {
      const lower = line.toLowerCase();
      if (blocked.has(lower) || blocked.has(line)) return false;
      if (line === title || line === displayUrl) return false;
      if (/^https?:\/\//i.test(line)) return false;
      if (/^[\w.-]+\.[a-z]{2,}/i.test(line)) return false;
      if (line.length < 12) return false;
      return true;
    });
    const description = parts.join(' ')
      .replace(/\s+/g, ' ')
      .replace(/\s*read more\s*$/i, '')
      .replace(/\s*read more\b/gi, '')
      .trim();
    return truncate(description, 500) || null;
  }

  function mediaUrlFrom(value) {
    if (!value) return null;
    const cleaned = String(value).trim();
    if (!cleaned || cleaned.startsWith('data:')) return null;
    try {
      return new URL(cleaned, location.href).href;
    } catch {
      return null;
    }
  }

  function backgroundImageUrl(element) {
    const background = getComputedStyle(element).backgroundImage || '';
    const match = background.match(/url\((['"]?)(.*?)\1\)/);
    return mediaUrlFrom(match?.[2]);
  }

  function thumbnailFor(block) {
    const images = Array.from(block.querySelectorAll('img'));
    for (const image of images) {
      const rect = image.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) continue;
      const url = mediaUrlFrom(image.currentSrc || image.src || image.getAttribute('data-src'));
      if (url) return url;
    }

    const elements = Array.from(block.querySelectorAll('*'));
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) continue;
      const url = backgroundImageUrl(element);
      if (url) return url;
    }

    return null;
  }

  function urlPartsFor(href) {
    try {
      const url = new URL(href);
      return {
        host: url.hostname,
        domain: url.hostname.replace(/^www\./, ''),
        path: url.pathname
      };
    } catch {
      return {
        host: null,
        domain: null,
        path: null
      };
    }
  }

  function cleanMetadataLine(line) {
    return String(line || '')
      .replace(/\s*·\s*/g, ' · ')
      .replace(/^[·.\s]+|[·.\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sourceNameFrom(block, title, displayUrl, domain) {
    const blocked = new Set([
      title,
      displayUrl,
      domain,
      'ad',
      'ads',
      'sponsored',
      'sponsored results',
      'web results',
      'read more'
    ].filter(Boolean).map(value => String(value).toLowerCase()));

    return linesOf(block).map(cleanMetadataLine).find(line => {
      const lower = line.toLowerCase();
      if (blocked.has(lower)) return false;
      if (line.length < 2 || line.length > 80 || line === '·' || line === '.') return false;
      if (/^https?:\/\//i.test(line)) return false;
      if (/^[\w.-]+\.[a-z]{2,}/i.test(line)) return false;
      if (DATE_RE.test(line) || RELATIVE_DATE_RE.test(line) || DURATION_RE.test(line)) return false;
      if (/^(?:read more|view all|more|about this result)$/i.test(line)) return false;
      return true;
    }) || domain || null;
  }

  function metadataFrom(block, href, title, displayUrl, description) {
    const urlParts = urlPartsFor(href);
    const source = sourceNameFrom(block, title, displayUrl, urlParts.domain);
    const lines = linesOf(block).map(cleanMetadataLine).filter(Boolean);
    const joined = lines.join(' ');

    return {
      source,
      host: urlParts.host,
      domain: urlParts.domain,
      path: urlParts.path,
      date: joined.match(DATE_RE)?.[0] || joined.match(RELATIVE_DATE_RE)?.[0] || null,
      duration: joined.match(DURATION_RE)?.[0] || null,
      thumbnailUrl: thumbnailFor(block),
      visibleMetadata: lines
        .filter(line => {
          if (line === title || line === displayUrl || line === description) return false;
          if (line === '·' || line === '.') return false;
          if (/^(?:read more|view all|more|about this result)$/i.test(line)) return false;
          return line.length > 0 && line.length <= 160;
        })
        .filter((line, index, all) => all.indexOf(line) === index)
        .slice(0, 8)
    };
  }

  function assignPresent(target, source) {
    for (const [key, value] of Object.entries(source)) {
      if (value !== null && value !== undefined) target[key] = value;
    }
    return target;
  }

  function resultLikeFromAnchor(anchor, type, rank, serpRank = null) {
    const url = cleanResultUrl(anchor.href);
    if (!url || isGoogleInternalUrl(url)) return null;

    const rawTitle = type === 'aiOverview'
      ? titleFromAria(anchor) || titleFor(anchor)
      : titleFor(anchor) || titleFromAria(anchor);
    if (!rawTitle || rawTitle.length < 3 || isNavLink(anchor, rawTitle, url)) return null;

    const block = resultBlockFor(anchor, type);
    const title = type === 'video' || type === 'shortVideo'
      ? videoTitleFor(anchor, rawTitle)
      : rawTitle;
    const displayUrl = displayUrlFor(anchor, url);
    const description = descriptionFrom(block, title, displayUrl);
    const metadata = metadataFrom(block, url, title, displayUrl, description);
    const result = {
      serpRank,
      type,
      title: truncate(title, 220),
      url,
      source: metadata.source,
      host: metadata.host,
      domain: metadata.domain,
      path: metadata.path,
      displayUrl,
      description,
      date: metadata.date,
      duration: metadata.duration,
      thumbnailUrl: metadata.thumbnailUrl,
      visibleMetadata: metadata.visibleMetadata
    };

    if (type === 'video' || type === 'shortVideo') {
      assignPresent(result, videoMetadataFor(anchor, block, url));
    } else if (type === 'aiOverview') {
      result.aiOverviewRank = rank;
    }

    return result;
  }

  function isVideoUrl(href) {
    try {
      const host = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
      return host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com') || host.includes('vimeo.com');
    } catch {
      return false;
    }
  }

  function isLikelyVideoResult(href, blockText) {
    return isVideoUrl(href) ||
      /\/video\//i.test(href) ||
      DURATION_RE.test(blockText) ||
      /\b(?:youtube|vimeo)\b/i.test(blockText) ||
      /\bvideo\b/i.test(blockText);
  }

  function isLikelyDiscussionResult(href, blockText) {
    try {
      const host = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
      if (['reddit.com', 'quora.com', 'facebook.com', 'linkedin.com', 'medium.com', 'x.com', 'twitter.com', 'instagram.com', 'threads.net'].includes(host)) return true;
      if (host.endsWith('.reddit.com') || host.endsWith('.quora.com') || host.endsWith('.twitter.com')) return true;
    } catch {
      // Fall through to text heuristics.
    }

    return /\b(?:comments?|votes?|popular comment|forum|forums|discussion|thread|subreddit)\b/i.test(blockText);
  }

  function videoTitleFor(anchor, fallbackTitle) {
    const candidates = [
      ...linesOf(anchor),
      anchor.getAttribute('aria-label') || ''
    ].filter(Boolean);

    for (const candidate of candidates) {
      const cleaned = candidate
        .replace(/\s+on\s+[^.]+\.?\s+Play.*$/i, '')
        .replace(/\s+by\s+.+?\s+on\s+.+?\.?\s+Play.*$/i, '')
        .replace(/\s+(?:YouTube|Vimeo)\s*·.*$/i, '')
        .replace(DATE_RE, '')
        .replace(DURATION_RE, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned.length >= 3) return cleaned;
    }

    return fallbackTitle;
  }

  function newsTitleFor(block, fallbackTitle) {
    const lines = linesOf(block).map(cleanMetadataLine);
    const candidates = lines.map((line, index) => ({ line, index })).filter(({ line }) => {
      if (line.length < 8 || line.length > 220) return false;
      if (/^https?:\/\//i.test(line)) return false;
      if (/^[\w.-]+\.[a-z]{2,}/i.test(line)) return false;
      if (DATE_RE.test(line) || RELATIVE_DATE_RE.test(line) || DURATION_RE.test(line)) return false;
      if (/^\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago$/i.test(line)) return false;
      if (/^(?:read more|view all|more|about this result)$/i.test(line)) return false;
      return true;
    });

    if (
      candidates.length >= 2 &&
      candidates[0].index === 0 &&
      candidates[0].line.length <= 80 &&
      candidates[1].line.length > candidates[0].line.length + 8
    ) {
      return candidates[1].line;
    }
    return candidates[0]?.line || fallbackTitle;
  }

  function imageTitleFor(block, fallbackTitle) {
    const candidates = linesOf(block).map(cleanMetadataLine).filter(line => {
      if (line.length < 8 || line.length > 220) return false;
      if (/^https?:\/\//i.test(line)) return false;
      if (/^[\w.-]+\.[a-z]{2,}/i.test(line)) return false;
      if (DATE_RE.test(line) || RELATIVE_DATE_RE.test(line) || DURATION_RE.test(line)) return false;
      if (/^(?:read more|view all|more|about this result)$/i.test(line)) return false;
      return true;
    });

    return candidates[0] || fallbackTitle;
  }

  function videoMetadataFor(anchor, block, href) {
    const lines = [...linesOf(anchor), ...linesOf(block), anchor.getAttribute('aria-label') || ''].filter(Boolean);
    const joined = lines.join(' ');
    const sourceFromUrl = (() => {
      try {
        const host = new URL(href).hostname.replace(/^www\./, '');
        if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'YouTube';
        if (host.endsWith('vimeo.com')) return 'Vimeo';
        return host;
      } catch {
        return null;
      }
    })();

    const sourceLine = lines.find(line => /\b(?:YouTube|Vimeo)\b\s*·/i.test(line));
    const sourceMatch = sourceLine?.match(/\b(YouTube|Vimeo)\b\s*·\s*([^·]+?)(?:\s{2,}|$)/i);
    const reverseSourceLine = lines.find(line => /·\s*\b(?:YouTube|Vimeo)\b/i.test(line));
    const reverseSourceMatch = reverseSourceLine?.match(/([^·]+?)\s*·\s*\b(YouTube|Vimeo)\b/i);
    const platform = sourceMatch?.[1] || reverseSourceMatch?.[2] || sourceFromUrl;
    const channel = sourceMatch?.[2]?.replace(DATE_RE, '').trim() ||
      reverseSourceMatch?.[1]?.replace(DATE_RE, '').trim() ||
      null;
    const date = joined.match(DATE_RE)?.[0] || joined.match(RELATIVE_DATE_RE)?.[0] || null;
    const duration = joined.match(DURATION_RE)?.[0] || null;

    return {
      platform,
      channel,
      date,
      duration
    };
  }

  function imageMetadataFor(anchor, block, href) {
    const imageUrl = googleImageUrlFromHref(href);
    const thumbnailUrl = thumbnailFor(block) || thumbnailFor(anchor);

    return {
      imageUrl,
      thumbnailUrl
    };
  }

  function resultKind(anchor, block, href, inSponsoredBand, featureType, pageVertical) {
    const adRoot = anchor.closest('#tads, #tadsb, #taw, #bottomads, [data-text-ad]');
    const blockText = textOf(block).slice(0, 800).toLowerCase();
    if (inSponsoredBand || adRoot || isLikelyAdUrl(href) || blockText.includes('sponsored')) return 'sponsored';
    if (pageVertical === 'images') return 'image';
    if (pageVertical === 'news') return 'news';
    if (pageVertical === 'forums') return 'discussion';
    if (pageVertical === 'videos') return 'video';
    if (pageVertical === 'shortVideos') return 'shortVideo';
    if (pageVertical === 'web') return 'organic';
    if (featureType === 'sponsored') return 'sponsored';
    if (featureType === 'video' || featureType === 'shortVideo') {
      return isLikelyVideoResult(href, blockText) ? featureType : 'organic';
    }
    if (isLikelyVideoResult(href, blockText) && isVideoUrl(href)) return 'video';
    if (featureType === 'discussion') {
      return isLikelyDiscussionResult(href, blockText) ? 'discussion' : 'organic';
    }
    if (featureType === 'news' || featureType === 'aiOverview') return featureType;
    if (isVideoUrl(href) && blockText.includes('youtube')) return 'video';
    if (blockText.includes('top stories') || blockText.includes('also in the news')) return 'news';
    if (blockText.includes('people also ask')) return 'question';
    return 'organic';
  }

  function normalizeLimit(value, fallback) {
    const number = Number(value ?? fallback);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(number, 50));
  }

  function normalizeDurationMs(value, fallback, max = 30000) {
    const number = Number(value ?? fallback);
    if (!Number.isFinite(number) || number < 0) return fallback;
    return Math.max(0, Math.min(Math.floor(number), max));
  }

  function emptyListings() {
    return {
      vertical: currentVertical(),
      organicResults: [],
      sponsoredResults: [],
      imageResults: [],
      videoResults: [],
      shortVideoResults: [],
      discussionResults: [],
      newsResults: [],
      aiOverview: emptyAiOverview(),
      aiOverviewResults: [],
      otherResults: [],
      allResults: [],
      suggestions: {
        questions: [],
        relatedSearches: []
      }
    };
  }

  function emptyAiOverview() {
    return {
      present: false,
      text: null,
      lines: [],
      links: []
    };
  }

  function countsFor(listings) {
    return {
      organic: listings.organicResults.length,
      sponsored: listings.sponsoredResults.length,
      images: listings.imageResults.length,
      videos: listings.videoResults.length,
      shortVideos: listings.shortVideoResults.length,
      discussions: listings.discussionResults.length,
      news: listings.newsResults.length,
      aiOverview: listings.aiOverviewResults.length,
      other: listings.otherResults.length,
      suggestions: listings.suggestions.questions.length + listings.suggestions.relatedSearches.length,
      all: listings.allResults.length
    };
  }

  function categoriesFor(listings) {
    return {
      sponsored: listings.sponsoredResults,
      organic: listings.organicResults,
      images: listings.imageResults,
      videos: listings.videoResults,
      shortVideos: listings.shortVideoResults,
      discussions: listings.discussionResults,
      news: listings.newsResults,
      aiOverview: listings.aiOverviewResults,
      other: listings.otherResults
    };
  }

  function normalizeBucket(value) {
    return BUCKET_ALIASES[String(value || 'organic')] || 'organic';
  }

  function queryFromGoogleSearchUrl(href) {
    try {
      const url = new URL(href);
      if (!GOOGLE_HOST_RE.test(url.hostname) || url.pathname !== '/search') return null;
      return url.searchParams.get('q');
    } catch {
      return null;
    }
  }

  function scanSuggestions(markers, type, limit) {
    const start = markers.find(marker => marker.type === type);
    if (!start || limit <= 0) return [];
    const end = markers.find(marker => marker.y > start.y + 8)?.y || Infinity;
    const seen = new Set();
    const suggestions = [];
    const candidates = Array.from(searchRoot().querySelectorAll('a[href], [role="button"]'));

    for (const element of candidates) {
      if (!visibleElement(element)) continue;
      const y = documentY(element);
      if (y < start.y || y >= end) continue;

      const text = textOf(element);
      if (text.length < 3 || text.length > 180 || text.toLowerCase() === start.label.toLowerCase()) continue;
      if (type === 'question' && !text.includes('?')) continue;

      const href = element.href || null;
      const item = {
        text: truncate(text, 180)
      };
      if (href) {
        item.url = cleanResultUrl(href);
        item.query = queryFromGoogleSearchUrl(href);
      }

      const key = `${type}\n${item.text}\n${item.url || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push(item);
      if (suggestions.length >= limit) break;
    }

    return suggestions;
  }

  function aiOverviewTextNoise(line, markerLabel) {
    const lower = line.toLowerCase();
    if (!lower || lower === markerLabel.toLowerCase() || lower === 'ai overview') return true;
    if (/^(?:show more|show less|more|about this result|sources?|sponsored results)$/i.test(line)) return true;
    if (/^my ad center(?:\s+my ad center)*$/i.test(line)) return true;
    if (/^\d+\s+sites?$/i.test(line) || /^\+\d+$/.test(line)) return true;
    if (/^[A-Z][\w .&-]{1,50}\s+\+\d+$/.test(line)) return true;
    return false;
  }

  function cleanAiOverviewLine(line) {
    return cleanMetadataLine(line)
      .replace(/^[\u200e\u200f\u2060\s]+|[\u200e\u200f\u2060\s]+$/g, '')
      .replace(/\s+[A-Z][A-Za-z0-9 .&-]{1,50}\s+\+\d+\s*$/, '')
      .trim();
  }

  function normalizedAiOverviewLinkTitle(result) {
    const title = cleanAiOverviewLine(result.title);
    const relatedLink = title.match(/^(.+?)\s*\(\+\d+\)\s*-\s*View related links$/i);
    return cleanAiOverviewLine(relatedLink?.[1] || title);
  }

  function aiOverviewLinkQuality(result) {
    let score = 0;
    if (result.description) score += 6;
    if (!/\bView related links\b/i.test(result.title)) score += 4;
    if ((result.visibleMetadata || []).length > 0) score += 2;
    if (result.thumbnailUrl) score += 1;
    if (result.title.length > 20) score += 1;
    return score;
  }

  function filterAiOverviewTextLines(lines, links) {
    const blocked = new Set();
    const addBlocked = value => {
      const cleaned = cleanAiOverviewLine(value || '');
      if (cleaned) blocked.add(cleaned);
    };

    for (const link of links) {
      addBlocked(link.title);
      addBlocked(link.source);
      addBlocked(link.displayUrl);
      addBlocked(link.description);
      for (const value of link.visibleMetadata || []) addBlocked(value);
    }

    return lines.filter(line => {
      const cleaned = cleanAiOverviewLine(line);
      if (blocked.has(cleaned)) return false;
      if (/^(?:https?:\/\/|[\w.-]+\.[a-z]{2,})/i.test(cleaned)) return false;
      return true;
    });
  }

  function aiOverviewTextLines(bounds) {
    const root = searchRoot();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = cleanMetadataLine(node.nodeValue);
        if (!text) return NodeFilter.FILTER_REJECT;

        const parent = node.parentElement;
        if (!parent || !visibleElement(parent)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('a[href], button, [role="button"], header, nav, [role="navigation"], script, style, noscript')) {
          return NodeFilter.FILTER_REJECT;
        }

        const y = documentY(parent);
        if (y < bounds.start || y >= bounds.end) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const rows = [];

    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      const rect = parent.getBoundingClientRect();
      const text = cleanAiOverviewLine(walker.currentNode.nodeValue);
      if (!text) continue;

      const y = Math.round(rect.top + window.scrollY);
      const previous = rows[rows.length - 1];
      if (previous && Math.abs(previous.y - y) <= 14) {
        previous.parts.push(text);
      } else {
        rows.push({ y, parts: [text] });
      }
    }

    return rows
      .map(row => cleanAiOverviewLine(row.parts.join(' ')))
      .filter(line => line.length > 0 && !aiOverviewTextNoise(line, bounds.label))
      .filter((line, index, all) => all.indexOf(line) === index)
      .slice(0, 40);
  }

  function scanAiOverview(markers, input = {}) {
    const bounds = boundsForFeature(markers, 'aiOverview');
    if (!bounds) return emptyAiOverview();

    const limit = normalizeLimit(input.aiOverviewLimit, 10);
    const linksByUrl = new Map();
    const linkOrder = [];
    const anchors = Array.from(searchRoot().querySelectorAll('a[href]'));

    if (limit > 0) {
      for (const anchor of anchors) {
        if (!visibleAnchor(anchor)) continue;

        const y = documentY(anchor);
        if (y < bounds.start || y >= bounds.end) continue;

        const result = resultLikeFromAnchor(anchor, 'aiOverview', linkOrder.length + 1);
        if (!result) continue;
        if (/^(?:show more|show less|more)$/i.test(result.title)) continue;

        result.title = normalizedAiOverviewLinkTitle(result);
        if (!result.title) continue;

        const existing = linksByUrl.get(result.url);
        if (!existing) {
          linkOrder.push(result.url);
          linksByUrl.set(result.url, result);
        } else if (aiOverviewLinkQuality(result) > aiOverviewLinkQuality(existing)) {
          linksByUrl.set(result.url, result);
        }
      }
    }

    const allLinks = linkOrder.map((url, index) => ({
      ...linksByUrl.get(url),
      aiOverviewRank: index + 1
    }));
    const links = allLinks.slice(0, limit);
    const lines = filterAiOverviewTextLines(aiOverviewTextLines(bounds), allLinks);

    return {
      present: true,
      text: truncate(lines.join(' '), 5000) || null,
      lines,
      links
    };
  }

  function scanListings(input = {}) {
    if (!isResultsPage()) {
      return emptyListings();
    }

    const includeGoogleLinks = input.includeGoogleLinks === true;
    const includeSitelinks = input.includeSitelinks === true;
    const includeOther = input.includeOther === true;
    const includeFeatures = input.includeFeatures !== false;
    const includeAiOverview = input.includeAiOverview !== false;
    const organicLimit = normalizeLimit(input.organicLimit ?? input.limit, 10);
    const sponsoredLimit = normalizeLimit(input.sponsoredLimit, 10);
    const imageLimit = normalizeLimit(input.imageLimit, 10);
    const videoLimit = normalizeLimit(input.videoLimit, 10);
    const shortVideoLimit = normalizeLimit(input.shortVideoLimit, 10);
    const discussionLimit = normalizeLimit(input.discussionLimit, 10);
    const newsLimit = normalizeLimit(input.newsLimit, 10);
    const aiOverviewLimit = normalizeLimit(input.aiOverviewLimit, includeAiOverview ? 10 : 0);
    const otherLimit = normalizeLimit(input.otherLimit, includeOther ? 10 : 0);
    const questionLimit = normalizeLimit(input.questionLimit, 10);
    const relatedSearchLimit = normalizeLimit(input.relatedSearchLimit, 10);
    const scanLimit = normalizeLimit(input.scanLimit, 80);
    const pageVertical = currentVertical();
    const seen = new Set();
    const organicResults = [];
    const sponsoredResults = [];
    const imageResults = [];
    const videoResults = [];
    const shortVideoResults = [];
    const discussionResults = [];
    const newsResults = [];
    const otherResults = [];
    const allResults = [];
    const adBand = sponsoredBand();
    const markers = featureMarkers();
    const aiOverviewBounds = includeFeatures ? boundsForFeature(markers, 'aiOverview') : null;
    const aiOverview = includeFeatures && includeAiOverview
      ? scanAiOverview(markers, { ...input, aiOverviewLimit })
      : emptyAiOverview();
    const aiOverviewResults = aiOverview.links;

    for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
      if (allResults.length >= scanLimit) break;
      if (!visibleAnchor(anchor)) continue;
      if (aiOverviewBounds && Number.isFinite(aiOverviewBounds.end) && isInBand(anchor, aiOverviewBounds)) continue;

      const url = cleanResultUrl(anchor.href);
      if (!url) continue;
      const inAdBand = isInBand(anchor, adBand);
      const featureType = includeFeatures ? featureForY(documentY(anchor), markers) : null;
      const isFeatureLink = Boolean(featureType && featureType !== 'web' && featureType !== 'question' && featureType !== 'relatedSearch');
      const isVerticalResultLink = pageVertical !== 'all' && pageVertical !== 'web';
      const hasMainHeading = Boolean(anchor.querySelector('h3'));
      if (!includeSitelinks && !hasMainHeading && !(inAdBand && hasDisplayedUrl(anchor, url)) && !isFeatureLink && !isVerticalResultLink) continue;

      const block = resultBlockFor(anchor, featureType);
      const kind = resultKind(anchor, block, url, inAdBand, featureType, pageVertical);
      if (kind === 'question' || kind === 'relatedSearch' || kind === 'web') continue;
      if (kind === 'aiOverview') continue;
      if (!includeFeatures && kind !== 'organic' && kind !== 'sponsored') continue;
      if (kind === 'other' && !includeOther) continue;
      if (!includeOther && !['organic', 'sponsored', 'image', 'video', 'shortVideo', 'discussion', 'news', 'aiOverview'].includes(kind)) continue;

      const rawTitle = titleFor(anchor);
      const title = kind === 'video' || kind === 'shortVideo'
        ? videoTitleFor(anchor, rawTitle)
        : kind === 'news'
          ? newsTitleFor(block, rawTitle)
          : kind === 'image'
            ? imageTitleFor(block, rawTitle)
            : rawTitle;
      if (!title || title.length < 3 || isNavLink(anchor, title, url)) continue;
      if (!includeSitelinks && !hasMainHeading && isSitelinkTitle(title)) continue;
      if (pageVertical === 'forums' && isForumMetadataTitle(title)) continue;
      if (!includeGoogleLinks && isGoogleInternalUrl(url)) continue;

      const key = kind === 'image' || kind === 'video' || kind === 'shortVideo' ? `${kind}\n${url}` : `${kind}\n${url}\n${title}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const displayUrl = displayUrlFor(anchor, url);
      const description = descriptionFrom(block, title, displayUrl);
      const metadata = metadataFrom(block, url, title, displayUrl, description);
      const base = {
        serpRank: allResults.length + 1,
        type: kind,
        title: truncate(title, 220),
        url,
        source: metadata.source,
        host: metadata.host,
        domain: metadata.domain,
        path: metadata.path,
        displayUrl,
        description,
        date: metadata.date,
        duration: metadata.duration,
        thumbnailUrl: metadata.thumbnailUrl,
        visibleMetadata: metadata.visibleMetadata
      };
      if (kind === 'image') {
        assignPresent(base, imageMetadataFor(anchor, block, anchor.href));
      } else if (kind === 'video' || kind === 'shortVideo') {
        assignPresent(base, videoMetadataFor(anchor, block, url));
      }

      if (kind === 'sponsored') {
        if (sponsoredLimit && sponsoredResults.length >= sponsoredLimit) continue;
        const result = { ...base, sponsoredRank: sponsoredResults.length + 1 };
        sponsoredResults.push(result);
        allResults.push(result);
      } else if (kind === 'image') {
        if (imageLimit && imageResults.length >= imageLimit) continue;
        const result = { ...base, imageRank: imageResults.length + 1 };
        imageResults.push(result);
        allResults.push(result);
      } else if (kind === 'organic') {
        if (organicLimit && organicResults.length >= organicLimit) continue;
        const result = { ...base, organicRank: organicResults.length + 1 };
        organicResults.push(result);
        allResults.push(result);
      } else if (kind === 'video') {
        if (videoLimit && videoResults.length >= videoLimit) continue;
        const result = { ...base, videoRank: videoResults.length + 1 };
        videoResults.push(result);
        allResults.push(result);
      } else if (kind === 'shortVideo') {
        if (shortVideoLimit && shortVideoResults.length >= shortVideoLimit) continue;
        const result = { ...base, shortVideoRank: shortVideoResults.length + 1 };
        shortVideoResults.push(result);
        allResults.push(result);
      } else if (kind === 'discussion') {
        if (discussionLimit && discussionResults.length >= discussionLimit) continue;
        const result = { ...base, discussionRank: discussionResults.length + 1 };
        discussionResults.push(result);
        allResults.push(result);
      } else if (kind === 'news') {
        if (newsLimit && newsResults.length >= newsLimit) continue;
        const result = { ...base, newsRank: newsResults.length + 1 };
        newsResults.push(result);
        allResults.push(result);
      } else if (kind === 'aiOverview') {
        if (aiOverviewLimit && aiOverviewResults.length >= aiOverviewLimit) continue;
        const result = { ...base, aiOverviewRank: aiOverviewResults.length + 1 };
        aiOverviewResults.push(result);
        allResults.push(result);
      } else {
        if (otherLimit && otherResults.length >= otherLimit) continue;
        const result = { ...base, otherRank: otherResults.length + 1 };
        otherResults.push(result);
        allResults.push(result);
      }
    }

    return {
      vertical: pageVertical,
      organicResults,
      sponsoredResults,
      imageResults,
      videoResults,
      shortVideoResults,
      discussionResults,
      newsResults,
      aiOverview,
      aiOverviewResults,
      otherResults,
      allResults,
      suggestions: {
        questions: scanSuggestions(markers, 'question', questionLimit),
        relatedSearches: scanSuggestions(markers, 'relatedSearch', relatedSearchLimit)
      }
    };
  }

  function getSearchState(input = {}) {
    const onResultsPage = isResultsPage();
    const listings = onResultsPage
      ? scanListings({ ...input, organicLimit: input.previewLimit ?? 3, sponsoredLimit: input.previewSponsoredLimit ?? 3 })
      : emptyListings();

    return {
      title: document.title,
      url: location.href,
      query: currentQuery(),
      vertical: listings.vertical,
      isResultsPage: onResultsPage,
      resultStats: resultStats(),
      counts: countsFor(listings),
      categories: categoriesFor(listings),
      suggestions: listings.suggestions,
      aiOverview: listings.aiOverview,
      previewOrganicResults: listings.organicResults,
      previewSponsoredResults: listings.sponsoredResults,
      previewImageResults: listings.imageResults,
      previewVideoResults: listings.videoResults,
      previewFeatureResults: [
        ...listings.imageResults,
        ...listings.videoResults,
        ...listings.shortVideoResults,
        ...listings.discussionResults,
        ...listings.newsResults,
        ...listings.aiOverviewResults,
        ...listings.otherResults
      ],
      previewResults: listings.allResults
    };
  }

  function search(input = {}) {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query) throw new Error('query is required.');
    const vertical = normalizeSearchVertical(input.vertical ?? input.page ?? input.category, 'all');
    if (!vertical) throw new Error('Unsupported Google search vertical.');

    const url = new URL('/search', location.origin);
    url.searchParams.set('q', query);
    applySearchVertical(url, vertical);
    setOptionalIntegerParam(url, input, 'num', 1);
    setOptionalIntegerParam(url, input, 'start', 0);
    if (typeof input.udm === 'string') {
      url.searchParams.delete('tbm');
      url.searchParams.set('udm', input.udm);
    }
    if (typeof input.tbm === 'string') {
      url.searchParams.delete('udm');
      url.searchParams.set('tbm', input.tbm);
    }
    location.assign(url.href);

    return {
      submitted: true,
      query,
      vertical,
      url: url.href
    };
  }

  function extractResults(input = {}) {
    const listings = scanListings(input);
    return {
      query: currentQuery(),
      url: location.href,
      vertical: listings.vertical,
      resultStats: resultStats(),
      counts: countsFor(listings),
      categories: categoriesFor(listings),
      suggestions: listings.suggestions,
      aiOverview: listings.aiOverview,
      organicResults: listings.organicResults,
      sponsoredResults: listings.sponsoredResults,
      imageResults: listings.imageResults,
      videoResults: listings.videoResults,
      shortVideoResults: listings.shortVideoResults,
      discussionResults: listings.discussionResults,
      newsResults: listings.newsResults,
      aiOverviewResults: listings.aiOverviewResults,
      otherResults: listings.otherResults,
      allResults: listings.allResults,
      results: listings.organicResults
    };
  }

  function mapsSearchUrl(input = {}) {
    const query = String(input.query || input.keywords || '').trim();
    if (!query) throw new Error('query is required.');
    const locationText = String(input.location || input.near || '').trim();
    const fullQuery = locationText && !new RegExp(`\\bnear\\b|\\b${locationText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(query)
      ? `${query} near ${locationText}`
      : query;
    return `https://www.google.com/maps/search/${encodeURIComponent(fullQuery)}`;
  }

  function searchMaps(input = {}) {
    const url = mapsSearchUrl(input);
    if (input.navigate !== false) location.assign(url);
    return {
      submitted: input.navigate !== false,
      query: input.query || input.keywords || null,
      location: input.location || input.near || null,
      url,
      nextAction: 'extractMapsResults'
    };
  }

  function mapsPlaceUrl(input = {}) {
    const rawUrl = String(input.url || input.mapsUrl || input.placeUrl || '').trim();
    if (rawUrl) return cleanResultUrl(rawUrl) || rawUrl;
    const placeId = String(input.placeId || '').trim();
    if (placeId) return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
    const query = String(input.query || input.name || input.title || input.keywords || '').trim();
    if (!query) throw new Error('Google Maps place research requires url, mapsUrl, placeUrl, placeId, query, name, title, or keywords.');
    const locationText = String(input.location || input.near || '').trim();
    const fullQuery = locationText && !/\bnear\b/i.test(query) ? `${query} near ${locationText}` : query;
    return `https://www.google.com/maps/search/${encodeURIComponent(fullQuery)}`;
  }

  function openMapsPlace(input = {}) {
    const url = mapsPlaceUrl(input);
    if (input.navigate !== false) location.assign(url);
    return {
      submitted: input.navigate !== false,
      url,
      nextAction: 'researchGoogleMapsPlace',
      nextInput: { ...input, navigate: false }
    };
  }

  function mapsEmptyState() {
    const text = textOf(document.body);
    const match = text.match(/No results found|Try a different search|Couldn'?t find/i);
    return {
      empty: Boolean(match),
      text: match ? match[0] : null
    };
  }

  function recorderEntries(input = {}) {
    const recorder = window.AiChromeRemote?.getNetworkEntries;
    if (typeof recorder !== 'function') {
      return { entries: [], total: 0, dropped: 0, nextId: 1, unavailable: true };
    }
    return recorder({
      limit: normalizeLimit(input.networkBufferLimit ?? input.bufferLimit, 250, 1000),
      sinceId: input.sinceId || 0,
      newestFirst: input.newestFirst === true,
      type: input.type || undefined
    }) || { entries: [], total: 0, dropped: 0, nextId: 1 };
  }

  function parseGoogleJsonText(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const cleaned = text
      .replace(/^\)\]\}'\s*/, '')
      .replace(/^\/\*.*?\*\/\s*/s, '')
      .trim();
    if (!cleaned) return null;
    const candidates = [cleaned];
    const firstJsonIndex = Math.min(
      ...[cleaned.indexOf('['), cleaned.indexOf('{')].filter(index => index >= 0)
    );
    if (Number.isFinite(firstJsonIndex) && firstJsonIndex > 0) candidates.push(cleaned.slice(firstJsonIndex));

    const parsedLines = [];
    for (const line of cleaned.split(/\n+/).map(value => value.trim()).filter(Boolean)) {
      if (!/^[\[{]/.test(line)) continue;
      try {
        parsedLines.push(JSON.parse(line));
      } catch {
        // Try the full candidates below.
      }
    }
    if (parsedLines.length === 1) return parsedLines[0];
    if (parsedLines.length > 1) return parsedLines;

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Keep trying less literal candidates.
      }
    }
    return null;
  }

  function entryJson(entry) {
    if (entry?.responseJsonPreview && typeof entry.responseJsonPreview === 'object') {
      if (typeof entry.responseJsonPreview.preview === 'string') return parseGoogleJsonText(entry.responseJsonPreview.preview);
      return entry.responseJsonPreview;
    }
    return parseGoogleJsonText(entry?.responseTextPreview);
  }

  function entryPreviewText(entry) {
    if (typeof entry?.responseTextPreview === 'string') return entry.responseTextPreview;
    if (entry?.responseJsonPreview !== undefined) {
      try {
        return JSON.stringify(entry.responseJsonPreview);
      } catch {
        return '';
      }
    }
    return '';
  }

  function googleMapsNetworkKind(url = '') {
    const text = String(url || '');
    if (/\/search\?.*\btbm=map\b/i.test(text)) return 'maps_search';
    if (/\/maps\/preview\/lp\b/i.test(text)) return 'maps_local_pack';
    if (/\/maps\/preview\/place|\/maps\/preview\/entity|\/maps\/preview\/pane/i.test(text)) return 'maps_place_detail';
    if (/\/maps\/preview\/log204|\/gen_204|\/log\b/i.test(text)) return 'telemetry';
    if (/\/maps\//i.test(text)) return 'maps_other';
    return 'other';
  }

  function compactNetworkEntry(entry, input = {}) {
    const json = entryJson(entry);
    const text = entryPreviewText(entry);
    return {
      id: entry.id,
      timestamp: entry.timestamp || null,
      kind: googleMapsNetworkKind(entry.url),
      type: entry.type || null,
      method: entry.method || null,
      url: cleanResultUrl(entry.url) || entry.url,
      status: entry.status ?? null,
      ok: entry.ok ?? null,
      durationMs: entry.durationMs ?? null,
      contentType: entry.responseHeaders?.['content-type'] || null,
      previewChars: text.length,
      hasJsonPreview: Boolean(json),
      hasTextPreview: Boolean(text),
      responseJsonPreview: input.includePreviewJson === true ? json : undefined,
      responseTextPreview: input.includePreviewText === true ? text : undefined
    };
  }

  function walk(value, visitor, depth = 0, seen = new WeakSet()) {
    if (value === null || value === undefined || depth > 14) return;
    if (typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    visitor(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visitor, depth + 1, seen);
      return;
    }
    for (const key of Object.keys(value)) walk(value[key], visitor, depth + 1, seen);
  }

  function collectScalarStrings(value, output = [], limit = 300, seen = new WeakSet()) {
    if (output.length >= limit || value === null || value === undefined) return output;
    if (typeof value === 'string') {
      const text = value.replace(/\s+/g, ' ').trim();
      if (text) output.push(text);
      return output;
    }
    if (typeof value !== 'object') return output;
    if (seen.has(value)) return output;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) collectScalarStrings(item, output, limit, seen);
      return output;
    }
    for (const key of Object.keys(value)) collectScalarStrings(value[key], output, limit, seen);
    return output;
  }

  function firstLatLng(value) {
    let found = null;
    walk(value, candidate => {
      if (found || !Array.isArray(candidate) || candidate.length < 4) return;
      const lat = Number(candidate[2]);
      const lng = Number(candidate[3]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        found = { latitude: lat, longitude: lng };
      }
    });
    return found;
  }

  function googleMapsPlaceIdFromUrl(value) {
    const text = String(value || '');
    const match = text.match(/0x[0-9a-f]+:0x[0-9a-f]+/i);
    return match ? match[0] : null;
  }

  function normalizeMapsIdentityText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(?:inc|llc|co|company)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function mapsLocationDistanceMeters(first, second) {
    const lat1 = Number(first?.latitude);
    const lon1 = Number(first?.longitude);
    const lat2 = Number(second?.latitude);
    const lon2 = Number(second?.longitude);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
    const radiusMeters = 6371000;
    const toRadians = degrees => degrees * Math.PI / 180;
    const deltaLat = toRadians(lat2 - lat1);
    const deltaLon = toRadians(lon2 - lon1);
    const a = Math.sin(deltaLat / 2) ** 2 +
      Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
      Math.sin(deltaLon / 2) ** 2;
    return 2 * radiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function cleanMapsCategoryName(value) {
    const text = String(value || '')
      .replace(/[^\x20-\x7E]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text || null;
  }

  function networkRatingValue(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 && number <= 5 ? number : null;
  }

  function networkReviewCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
  }

  function networkRatingFromArray(value) {
    if (!Array.isArray(value)) return { value: null, count: null };
    const textRating = parseRatingText(collectScalarStrings(value, [], 80).join(' '));
    if (textRating.value || textRating.count) return textRating;
    let rating = null;
    walk(value, candidate => {
      if (rating !== null || !Array.isArray(candidate)) return;
      const numeric = candidate.filter(item => typeof item === 'number');
      const match = numeric.find(number => number >= 1 && number <= 5 && !Number.isInteger(number));
      if (match !== undefined) rating = match;
    });
    return { value: rating, count: null };
  }

  function cleanNetworkHoursText(value) {
    return String(value || '')
      .replace(/[\u00A0\u202F]/g, ' ')
      .replace(/[–—]/g, ' to ')
      .replace(/\s+/g, ' ')
      .trim() || null;
  }

  function extractNetworkPhoneFromSearchRecord(raw) {
    const phone = raw?.[178]?.[0]?.[0];
    if (typeof phone !== 'string') return null;
    const cleaned = phone.replace(/\s+/g, ' ').trim();
    return /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(cleaned) ? cleaned : null;
  }

  function extractNetworkWeeklyHoursFromSearchRecord(raw) {
    const rows = raw?.[203]?.[0];
    if (!Array.isArray(rows)) return [];
    const byDay = new Map();
    for (const row of rows) {
      if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
      const day = row[0].trim();
      const ranges = (Array.isArray(row[3]) ? row[3] : [])
        .map(range => cleanNetworkHoursText(Array.isArray(range) ? range[0] : range))
        .filter(Boolean);
      const notes = (Array.isArray(row[6]) ? row[6] : [])
        .filter(value => typeof value === 'string')
        .map(cleanNetworkHoursText)
        .filter(Boolean);
      const text = ranges.length ? ranges.join(', ') : 'Closed';
      byDay.set(day.toLowerCase(), {
        day,
        text,
        closed: !ranges.length || /\bclosed\b/i.test(text),
        notes: uniqueBy(notes, value => value.toLowerCase(), 5)
      });
    }
    return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
      .map(day => byDay.get(day.toLowerCase()))
      .filter(Boolean);
  }

  function networkPhotoDimensions(value) {
    return {
      width: Number.isFinite(Number(value?.[0])) ? Number(value[0]) : null,
      height: Number.isFinite(Number(value?.[1])) ? Number(value[1]) : null
    };
  }

  function networkPhotoItemFromRecord(record, category, rank, sourceTag) {
    if (!Array.isArray(record)) return null;
    const media = Array.isArray(record[6]) ? record[6] : [];
    const url = mediaUrlFrom(media[0]);
    if (!url || !/googleusercontent\.com/i.test(url)) return null;
    const dimensions = networkPhotoDimensions(media[2]);
    const label = cleanMapsPhotoLabel(record[3] || media[1] || '');
    return {
      id: String(record[0] || url.split(/[?#]/)[0]),
      type: 'image',
      url,
      thumbnailUrl: url,
      width: dimensions.width,
      height: dimensions.height,
      category,
      label: label || null,
      capturedAt: null,
      authorName: null,
      authorProfileUrl: null,
      sourceUrl: null,
      sourceTag,
      rank,
      source: { type: 'network' }
    };
  }

  function extractNetworkPhotosFromSearchRecord(raw, input = {}) {
    if (input.includePhotos !== true) return null;
    const limit = normalizeLimit(input.photoLimit ?? input.photosLimit, 20);
    const heroRecords = Array.isArray(raw?.[72]?.[0]) ? raw[72][0] : [];
    const gridRecords = Array.isArray(raw?.[105]?.[0]?.[1]?.[0]) ? raw[105][0][1][0] : [];
    const items = uniqueBy(
      [
        ...heroRecords.map((record, index) => networkPhotoItemFromRecord(record, 'All', index + 1, 'networkHero')),
        ...gridRecords.map((record, index) => networkPhotoItemFromRecord(record, 'All', heroRecords.length + index + 1, 'networkPhotoGrid'))
      ],
      item => item.id || item.url,
      limit
    );
    if (!items.length) return null;
    const totalCount = Number(raw?.[105]?.[0]?.[1]?.[1] ?? raw?.[37]?.[1]);
    return {
      source: 'googleMapsNetwork',
      availableCategories: ['All'],
      requestedCategories: requestedMapsPhotoCategories(input),
      categories: [{
        label: 'All',
        source: 'googleMapsNetwork',
        requested: 'All',
        sourceCategories: ['All'],
        items
      }],
      items,
      totalCount: Number.isFinite(totalCount) ? totalCount : null
    };
  }

  function normalizeGoogleMapsSearchPlaceRecord(raw, source = {}, input = {}) {
    if (!Array.isArray(raw)) return null;
    const placeId = typeof raw[10] === 'string' && /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(raw[10]) ? raw[10] : null;
    const title = cleanMapsTitle(raw[11]);
    const latLng = Array.isArray(raw[9]) ? raw[9] : [];
    const latitude = Number(latLng[2]);
    const longitude = Number(latLng[3]);
    if (!placeId || !title || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    const address = cleanMapsAddress(raw[17] || (Array.isArray(raw[2]) ? raw[2].join(', ') : null));
    const ratingBlock = Array.isArray(raw[4]) ? raw[4] : [];
    const categories = uniqueBy(
      (Array.isArray(raw[13]) ? raw[13] : [])
        .map(cleanMapsCategoryName)
        .filter(Boolean),
      category => category.toLowerCase(),
      10
    );
    const websiteUrl = mapsExternalUrl(Array.isArray(raw[7]) ? raw[7][0] : null);
    const priceRange = parsePriceRange([ratingBlock[2], ratingBlock[4]].filter(Boolean));
    const hours = extractNetworkWeeklyHoursFromSearchRecord(raw);
    const phone = extractNetworkPhoneFromSearchRecord(raw);
    const photos = extractNetworkPhotosFromSearchRecord(raw, input);

    return {
      id: placeId,
      placeId,
      platform: 'googleMaps',
      type: 'place',
      title,
      mapsUrl: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`,
      websiteUrl,
      rating: {
        value: networkRatingValue(ratingBlock[7]),
        count: networkReviewCount(ratingBlock[8])
      },
      primaryCategory: categories[0] || null,
      categories,
      priceRange,
      address,
      addressStructured: structuredAddressFromText(address),
      location: { latitude, longitude },
      currentHoursText: null,
      hours,
      phone,
      photos,
      source
    };
  }

  function extractGoogleMapsSearchPlaces(json, source = {}, input = {}) {
    const places = [];
    walk(json, value => {
      const place = normalizeGoogleMapsSearchPlaceRecord(value, source, input);
      if (place) places.push(place);
    });
    return uniqueBy(places, place => place.placeId, 100);
  }

  function normalizeGoogleMapsNetworkPlace(raw, source = {}) {
    if (!Array.isArray(raw)) return null;
    const placeId = typeof raw[0] === 'string' && /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(raw[0]) ? raw[0] : null;
    const title = typeof raw[1] === 'string' && raw[1].trim() ? raw[1].trim() : null;
    if (!placeId || !title) return null;
    const strings = uniqueBy(collectScalarStrings(raw), value => value, 300);
    const urls = strings.map(value => cleanResultUrl(value)).filter(Boolean);
    const websiteUrl = urls.find(url => {
      try {
        const parsed = new URL(url);
        return !GOOGLE_HOST_RE.test(parsed.hostname);
      } catch {
        return false;
      }
    }) || null;
    const categories = mapsCategoriesFromParts(mapsFactParts(strings));
    const location = firstLatLng(raw);
    const snippets = strings.filter(value => {
      if (value === title || value === websiteUrl) return false;
      if (/^https?:\/\//i.test(value) || /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(value)) return false;
      if (value.length < 12 || value.length > 240) return false;
      return /[a-z]/i.test(value);
    }).slice(0, 12);
    return {
      id: placeId,
      placeId,
      platform: 'googleMaps',
      type: 'place',
      title,
      mapsUrl: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`,
      websiteUrl,
      rating: networkRatingFromArray(raw),
      primaryCategory: categories[0] || null,
      categories,
      priceRange: parsePriceRange(strings) || null,
      location,
      snippets,
      source
    };
  }

  function extractGoogleMapsNetworkObjects(input = {}) {
    const raw = recorderEntries(input);
    const entries = Array.isArray(raw.entries) ? raw.entries : [];
    const compactEntries = [];
    const places = [];
    for (const entry of entries) {
      const kind = googleMapsNetworkKind(entry.url);
      if (kind === 'telemetry' && input.includeTelemetry !== true) continue;
      const compact = compactNetworkEntry(entry, input);
      compactEntries.push(compact);
      const json = entryJson(entry);
      if (!json) continue;
      if (kind === 'maps_search') {
        places.push(...extractGoogleMapsSearchPlaces(json, { type: 'network', kind, entryId: entry.id, url: compact.url }, input));
      } else if (input.includeGenericNetworkPlaces === true) {
        walk(json, value => {
          const place = normalizeGoogleMapsNetworkPlace(value, { type: 'network', kind, entryId: entry.id, url: compact.url, confidence: 'generic' });
          if (place) places.push(place);
        });
      }
    }
    return {
      recorder: {
        total: raw.total ?? entries.length,
        dropped: raw.dropped || 0,
        nextId: raw.nextId || null,
        unavailable: raw.unavailable === true
      },
      entries: compactEntries,
      places: uniqueBy(places, place => place.placeId || place.title, normalizeLimit(input.placeLimit ?? input.limit, 25, 100))
    };
  }

  async function extractGoogleMapsNetworkEvidence(input = {}) {
    const evidence = extractGoogleMapsNetworkObjects(input);
    const endpointCounts = {};
    for (const entry of evidence.entries) endpointCounts[entry.kind] = (endpointCounts[entry.kind] || 0) + 1;
    return {
      id: 'googleMaps',
      url: location.href,
      query: currentQuery(),
      recorder: evidence.recorder,
      endpointCounts,
      entries: evidence.entries.slice(0, normalizeLimit(input.networkEntryLimit ?? input.limit, 30, 100)),
      placeCandidates: evidence.places.slice(0, normalizeLimit(input.placeLimit ?? input.limit, 20, 100))
    };
  }

  function mapsFactParts(lines) {
    return uniqueBy(
      lines.flatMap(line => String(line || '').split(/\s*[·•]\s*/))
        .map(part => part.replace(/[^\S\r\n]+/g, ' ').replace(/[^\x20-\x7E]+/g, ' ').trim())
        .filter(Boolean),
      part => part.toLowerCase(),
      80
    );
  }

  function parseRatingText(text) {
    const ratingMatch = String(text || '').match(/\b([1-5](?:\.\d)?)\s*(?:stars?|star)?(?:\s*\(|\b)/i);
    const reviewMatch = String(text || '').match(/\(([\d,]+)\)|\b([\d,]+)\s*(?:reviews?|Google reviews?)\b/i);
    return {
      value: ratingMatch ? Number(ratingMatch[1]) : null,
      count: reviewMatch ? Number((reviewMatch[1] || reviewMatch[2]).replace(/,/g, '')) : null
    };
  }

  function parsePriceRange(parts) {
    return parts.find(part => /^\${1,4}$|^\$\d+(?:\s*[–-]\s*\$?\d+)?$/.test(part)) || null;
  }

  function isMapsAddressPart(value) {
    const text = String(value || '').trim();
    if (!/\b\d{2,6}\s+/.test(text)) return false;
    if (/reviews?|\bstars?\b|\brating\b|\$|Open|Closed|Closes|Opens/i.test(text)) return false;
    return /\b(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place|way|pkwy|parkway|hwy|highway|cir|circle)\b\.?|,\s*[A-Z]{2}\b/i.test(text);
  }

  function cleanMapsAddress(value) {
    const text = String(value || '')
      .replace(/^Address:\s*/i, '')
      .replace(/[^\x20-\x7E]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return null;
    const parts = text.split(/\s*[·•]\s*/).map(part => part.trim()).filter(Boolean);
    const addressPart = parts.find(isMapsAddressPart) || (isMapsAddressPart(text) ? text : null);
    if (!addressPart) return null;
    return addressPart
      .replace(/^[^\d]*(?=\d{2,6}\s+)/, '')
      .replace(/\s+(?:Open|Closed|Closes|Opens)\b.*$/i, '')
      .replace(/\s+(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b.*$/, '')
      .trim() || null;
  }

  function structuredAddressFromText(value) {
    const formatted = cleanMapsAddress(value);
    if (!formatted) return null;
    const match = formatted.match(/^(.+?),\s*([^,]+),\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?(?:,\s*(.+))?$/);
    return {
      formatted,
      streetAddress: match ? match[1] : formatted,
      locality: match ? match[2] : null,
      region: match ? match[3] : null,
      postalCode: match ? match[4] || null : null,
      country: match ? match[5] || null : null
    };
  }

  function isMapsCategoryPart(part) {
    if (!part || /\d{2,6}\s+/.test(part)) return false;
    if (/^["']/.test(part.trim())) return false;
    if (/^\$|reviews?|\bstars?\b|\bOpen\b|\bClosed\b|Closes|Opens|Directions|Website|Order online|Call/i.test(part)) return false;
    if (/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(part)) return false;
    return /restaurant|korean|thai|japanese|mexican|italian|american|bar|cafe|coffee|bakery|store|shop|hotel|food|gluten free|service|contractor|doctor|clinic|salon|museum|park|school|agency|company/i.test(part);
  }

  function mapsCategoriesFromParts(parts) {
    return uniqueBy(parts.filter(isMapsCategoryPart), part => part.toLowerCase(), 5);
  }

  function cleanMapsTitle(value) {
    const text = String(value || '')
      .replace(/[^\x20-\x7E]+/g, ' ')
      .replace(/\s*[·•]\s*Visited link\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (isInvalidMapsTitle(text)) return null;
    return text || null;
  }

  function isInvalidMapsTitle(value) {
    const text = String(value || '').trim();
    if (!text) return true;
    if (/^(?:Results|Hours|Overview|Reviews?|Photos?|Menu|About|Updates|Services?|Directions|Website|Call|Share|Save|Order|Reserve)$/i.test(text)) return true;
    if (/^Google Account:/i.test(text) || /@[\w.-]+\.[a-z]{2,}/i.test(text)) return true;
    if (/^(?:hours?\s+)?might differ$/i.test(text) || /^holiday hours$/i.test(text)) return true;
    if (/^(?:Open|Closed|Closes|Opens)\b/i.test(text)) return true;
    if (/\b(?:AM|PM)\b|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(text)) return true;
    if (isWeeklyHoursLine(text) || isMapsAddressPart(text)) return true;
    if (/^[1-5](?:\.\d)?(?:\s*stars?)?(?:\s*\(\d[\d,]*\))?$/i.test(text)) return true;
    return false;
  }

  function firstCleanMapsTitle(candidates) {
    for (const candidate of candidates) {
      const title = cleanMapsTitle(candidate);
      if (title) return title;
    }
    return null;
  }

  function titleBeforeMapsScheduleText(value) {
    const text = String(value || '')
      .replace(/[^\x20-\x7E]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleanMapsTitle(text
      .replace(/^Hours\b\s*/i, '')
      .replace(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b.*$/i, '')
      .replace(/\b(?:Open|Closed|Closes|Opens)\b.*$/i, '')
      .trim());
  }

  function looksLikeMapsBusinessName(value) {
    const text = cleanMapsTitle(value);
    if (!text || text.length > 100) return false;
    if (/offering|serving|located|available|delivery|takeout|dine-in/i.test(text)) return false;
    if (/^(?:restaurant|bakery|store|shop|park|seafood restaurant|korean restaurant|mexican restaurant|italian restaurant|american restaurant|dessert shop)$/i.test(text)) return false;
    return /\b[A-Z][A-Za-z0-9'&.-]+\b/.test(text);
  }

  function mapsDetailTitleFromLines(lines, parts = []) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = String(lines[index] || '').trim();
      if (/^Hours\b/i.test(line)) {
        const title = titleBeforeMapsScheduleText(line) || titleBeforeMapsScheduleText(lines[index + 1]);
        if (title) return title;
      }
    }
    return firstCleanMapsTitle(parts.filter(looksLikeMapsBusinessName));
  }

  function mapsCategoriesForPlace(parts, title) {
    const normalizedTitle = String(title || '').toLowerCase();
    return mapsCategoriesFromParts(parts).filter(category => category.toLowerCase() !== normalizedTitle);
  }

  function mapsExternalUrl(value) {
    const raw = String(value || '').replace(/^Website:\s*/i, '').trim();
    if (!raw) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : (/^[\w.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(raw) ? `https://${raw}` : raw);
    const url = cleanResultUrl(withScheme);
    if (!url) return null;
    try {
      const parsed = new URL(url);
      return GOOGLE_HOST_RE.test(parsed.hostname) ? null : parsed.href;
    } catch {
      return null;
    }
  }

  function currentHoursFromParts(parts) {
    return parts.find(part => /\bOpen\b|\bClosed\b|opens|closes/i.test(part)) || null;
  }

  function mapsDetailElements() {
    return Array.from(document.querySelectorAll('button[aria-label], a[aria-label], div[aria-label]'));
  }

  function detailValueFromAria(label) {
    const regex = new RegExp(`^${label}:\\s*(.+)$`, 'i');
    const element = mapsDetailElements().find(item => regex.test(item.getAttribute('aria-label') || ''));
    return element?.getAttribute('aria-label')?.match(regex)?.[1]?.trim() || null;
  }

  function mapsDetailRoot() {
    return document.querySelector('div[role="main"]') || document.querySelector('div[aria-label][role="region"]') || document.body;
  }

  function mapsDetailFromCurrentPage(input = {}) {
    const root = mapsDetailRoot();
    const detailText = textOf(root);
    const detailLines = linesOf(root);
    const headingTitle = root.querySelector?.('h1')?.textContent?.trim() || null;
    const address = cleanMapsAddress(detailValueFromAria('Address') || detailLines.find(isMapsAddressPart));
    const websiteValue = detailValueFromAria('Website');
    const phone = detailValueFromAria('Phone') || detailText.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/)?.[0] || null;
    const parts = mapsFactParts(detailLines);
    const title = firstCleanMapsTitle([headingTitle]) || mapsDetailTitleFromLines(detailLines, parts);
    if (/^Results$/i.test(title || '')) return null;
    const categories = mapsCategoriesForPlace(parts, title);
    const hours = parseWeeklyHoursFromDom();
    if (!headingTitle && !/\/maps\/place\//i.test(location.pathname)) return null;
    if (!headingTitle && !address && !phone && !websiteValue && hours.length === 0) return null;
    return {
      id: cleanResultUrl(location.href) || location.href,
      platform: 'googleMaps',
      type: 'place',
      rank: 1,
      title,
      mapsUrl: cleanResultUrl(location.href) || location.href,
      websiteUrl: mapsExternalUrl(websiteValue),
      rating: parseRatingText(detailText),
      primaryCategory: categories[0] || null,
      categories,
      priceRange: parsePriceRange(parts),
      address,
      addressStructured: structuredAddressFromText(address),
      currentHoursText: currentHoursFromParts(mapsFactParts(detailLines)),
      hours,
      phone,
      text: truncate(detailText, normalizeLimit(input.textMaxChars, 1200, 5000)),
      source: { type: 'detailPanel', position: elementScreenPosition(root) }
    };
  }

  function parseWeeklyHoursFromLines(lines) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const output = [];
    for (const day of days) {
      const line = lines.find(value => new RegExp(`^${day}\\b|\\b${day},`, 'i').test(value));
      if (!line) continue;
      const text = line
        .replace(new RegExp(`^${day},?\\s*`, 'i'), '')
        .replace(/^Hours:\s*/i, '')
        .replace(/\bCopy open hours\b/gi, '')
        .replace(/[–—]/g, ' to ')
        .replace(/[^\x20-\x7E]+/g, ' ')
        .replace(/\)\s*(?=\d)/g, ') ')
        .replace(/\s+/g, ' ')
        .replace(/\s*,\s*$/, '')
        .trim();
      output.push({
        day,
        text: text || null,
        closed: /\bclosed\b/i.test(text)
      });
    }
    return output;
  }

  function isWeeklyHoursLine(value) {
    return /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(String(value || '').trim());
  }

  function parseWeeklyHoursFromDom() {
    const tableRows = Array.from(document.querySelectorAll('table tr'))
      .map(row => linesOf(row).join(' ').trim())
      .filter(Boolean);
    const roleRows = Array.from(document.querySelectorAll('[role="row"], [data-day], div[aria-label]'))
      .map(row => linesOf(row).join(' ').trim() || row.getAttribute?.('aria-label') || '')
      .filter(Boolean);
    const labelled = mapsDetailElements()
      .map(element => element.getAttribute('aria-label') || '')
      .filter(label => /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/i.test(label));
    const rootLines = linesOf(mapsDetailRoot());
    const splitRootLines = rootLines.flatMap(line => {
      const matches = line.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b.*?(?=(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|$)/gi);
      return matches?.length ? matches : [line];
    });
    return parseWeeklyHoursFromLines(uniqueBy([...tableRows, ...roleRows, ...labelled, ...splitRootLines], line => line, 120));
  }

  function hoursControlScore(element) {
    const label = element.getAttribute?.('aria-label') || '';
    const text = textOf(element);
    const combined = `${label} ${text}`.replace(/\s+/g, ' ').trim();
    if (!combined) return 0;
    if (/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(combined)) return 0;
    if (/Directions|Website|Call|Reviews?|Photos?|Share|Save|Order|Reserve/i.test(combined)) return 0;
    let score = 0;
    if (/hours/i.test(combined)) score += 5;
    if (/\b(?:Open|Closed)\b/i.test(combined)) score += 3;
    if (/\b(?:Closes|Opens|Reopens)\b/i.test(combined)) score += 3;
    if (/data-item-id=["']?oh/i.test(element.outerHTML || '')) score += 6;
    if (element.matches?.('button, [role="button"]')) score += 1;
    return score;
  }

  function candidateHoursControls() {
    return Array.from(document.querySelectorAll([
      'button[aria-label]',
      'div[role="button"][aria-label]',
      '[data-item-id*="oh"]',
      '[aria-label*="Hours"]',
      '[aria-label*="Open"]',
      '[aria-label*="Closed"]',
      '[aria-label*="Closes"]',
      '[aria-label*="Opens"]'
    ].join(', ')))
      .filter(element => visibleElement(element))
      .map(element => ({ element, score: hoursControlScore(element) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.element);
  }

  async function expandWeeklyHours(input = {}) {
    let hours = parseWeeklyHoursFromDom();
    if (hours.length >= 5 || input.includeHours === false || input.expandHours === false) return hours;

    const control = candidateHoursControls()[0];
    if (!control) return hours;
    control.click?.();

    const timeoutMs = normalizeDurationMs(input.hoursTimeoutMs, 1800, 5000);
    const intervalMs = normalizeDurationMs(input.hoursPollMs, 150, 1000);
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      hours = parseWeeklyHoursFromDom();
      if (hours.length >= 5) break;
    }
    return hours;
  }

  async function mapsDetailFromCurrentPageWithHours(input = {}) {
    await expandWeeklyHours(input);
    return mapsDetailFromCurrentPage(input);
  }

  function cleanMapsPhotoLabel(value) {
    return String(value || '')
      .replace(/[^\x20-\x7E]+/g, ' ')
      .replace(/\s*&\s*/g, ' & ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function mapsPhotoCategoryKey(value) {
    return cleanMapsPhotoLabel(value)
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '');
  }

  const MAPS_CORE_PHOTO_CATEGORY_KEYS = new Set([
    'all',
    'latest',
    'videos',
    'menu',
    'food',
    'foodanddrink',
    'vibe',
    'inside',
    'interior',
    'outside',
    'exterior',
    'rooms',
    'room',
    'amenities',
    'amenity',
    'byowner',
    'fromvisitors',
    'streetviewand360',
    'streetview360'
  ]);

  function mapsPhotoCategoryRequestKeys(value) {
    const key = mapsPhotoCategoryKey(value);
    if (!key) return [];
    if (key === 'video') return ['videos'];
    if (key === 'fooddrink') return ['foodanddrink', 'food'];
    if (key === 'foodanddrink') return ['foodanddrink', 'food'];
    if (key === 'food') return ['food', 'foodanddrink'];
    if (key === 'interior') return ['inside', 'interior'];
    if (key === 'inside') return ['inside', 'interior'];
    if (key === 'outside') return ['outside', 'exterior'];
    if (key === 'exterior') return ['exterior', 'outside'];
    if (key === 'room') return ['rooms', 'room'];
    if (key === 'amenity') return ['amenities', 'amenity'];
    if (key === 'owner') return ['byowner'];
    if (key === 'byowner') return ['byowner'];
    if (key === 'visitors' || key === 'fromvisitor') return ['fromvisitors'];
    if (key === 'streetview' || key === 'streetview360' || key === 'streetviewand360') return ['streetviewand360', 'streetview360'];
    return [key];
  }

  function requestedMapsPhotoCategories(input = {}) {
    const raw = input.photoCategories ?? input.photoCategory ?? ['All'];
    const values = Array.isArray(raw)
      ? raw
      : String(raw || 'All').split(',').map(value => value.trim());
    return values.map(cleanMapsPhotoLabel).filter(Boolean);
  }

  function mapsPhotoCategoryTabs() {
    return Array.from(document.querySelectorAll('button[role="tab"], [role="tab"]'))
      .filter(element => visibleElement(element))
      .map(element => ({
        element,
        label: cleanMapsPhotoLabel(textOf(element) || element.getAttribute?.('aria-label') || ''),
      }))
      .filter(tab => tab.label && tab.label.length <= 80);
  }

  function mapsPhotosPanelOpen() {
    return mapsPhotoCategoryTabs().length > 0 && document.querySelectorAll('a.MIgS0d').length > 0;
  }

  function photoPanelControlScore(element) {
    const text = cleanMapsPhotoLabel(`${element.getAttribute?.('aria-label') || ''} ${textOf(element)}`);
    if (!text) return 0;
    if (/add photos|add photo/i.test(text)) return 0;
    if (/see photos/i.test(text)) return 10;
    if (/^photo of\b/i.test(text)) return 8;
    if (/\bphotos?\b/i.test(text)) return 4;
    return 0;
  }

  function candidatePhotoPanelControls() {
    return Array.from(document.querySelectorAll([
      'button.Dx2nRe',
      'button[aria-label^="Photo of"]',
      'button[aria-label*="photos"]',
      'button[aria-label*="Photos"]'
    ].join(', ')))
      .filter(element => visibleElement(element))
      .map(element => ({ element, score: photoPanelControlScore(element) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.element);
  }

  async function openMapsPhotosPanel(input = {}) {
    if (mapsPhotosPanelOpen()) return true;
    const control = candidatePhotoPanelControls()[0];
    if (!control) return false;
    control.click?.();
    const timeoutMs = normalizeDurationMs(input.photoTimeoutMs, 4000, 15000);
    const intervalMs = normalizeDurationMs(input.photoPollMs, 250, 1500);
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      if (mapsPhotosPanelOpen()) return true;
    }
    return mapsPhotosPanelOpen();
  }

  function mapsPhotoTabMatchesRequest(label, requested) {
    const tabKey = mapsPhotoCategoryKey(label);
    const requestKeys = mapsPhotoCategoryRequestKeys(requested);
    return requestKeys.includes(tabKey);
  }

  function isOtherMapsPhotoCategory(label) {
    const key = mapsPhotoCategoryKey(label);
    return Boolean(key) && !MAPS_CORE_PHOTO_CATEGORY_KEYS.has(key);
  }

  function selectedMapsPhotoTabs(requested, availableTabs) {
    const selections = [];
    for (const request of requested) {
      if (mapsPhotoCategoryKey(request) === 'other') {
        const otherTabs = availableTabs.filter(tab => isOtherMapsPhotoCategory(tab.label));
        if (otherTabs.length) selections.push({ label: 'Other', aggregate: true, tabs: otherTabs });
        continue;
      }
      const tab = availableTabs.find(candidate => mapsPhotoTabMatchesRequest(candidate.label, request));
      if (tab) selections.push({ label: tab.label, aggregate: false, tabs: [tab] });
    }
    return uniqueBy(selections, item => item.label.toLowerCase(), 20);
  }

  async function selectMapsPhotoTab(tab, input = {}) {
    tab.element.click?.();
    await new Promise(resolve => setTimeout(resolve, normalizeDurationMs(input.photoCategoryWaitMs, 900, 5000)));
  }

  function decodeMapsPhotoUrlSegment(value) {
    if (!value) return null;
    let decoded = String(value);
    for (let index = 0; index < 2; index += 1) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    return mediaUrlFrom(decoded.replace(/\\u003d/g, '='));
  }

  function mapsPhotoUrlFromHref(href) {
    const text = String(href || '');
    const match = text.match(/!6s([^!#]+)/);
    return decodeMapsPhotoUrlSegment(match?.[1]);
  }

  function mapsPhotoIdFromHref(href) {
    const text = String(href || '');
    const match = text.match(/!1s([^!#]+)!2e/);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  function mapsPhotoDimensionsFromHref(href) {
    const text = String(href || '');
    const width = Number(text.match(/(?:!|%21)7i(\d+)/)?.[1]);
    const height = Number(text.match(/(?:!|%21)8i(\d+)/)?.[1]);
    return {
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null
    };
  }

  function mapsPhotoMediaFromTile(tile) {
    const directImage = Array.from(tile.querySelectorAll?.('img') || [])
      .map(image => mediaUrlFrom(image.currentSrc || image.src || image.getAttribute('data-src')))
      .find(Boolean);
    if (directImage) return directImage;
    const background = backgroundImageUrl(tile);
    if (background) return background;
    const childBackground = Array.from(tile.querySelectorAll?.('*') || [])
      .map(backgroundImageUrl)
      .find(Boolean);
    return childBackground || mapsPhotoUrlFromHref(tile.href);
  }

  function mapsPhotoTypeFromTile(tile, category) {
    const label = cleanMapsPhotoLabel(`${tile.getAttribute?.('aria-label') || ''} ${textOf(tile)}`);
    const categoryKey = mapsPhotoCategoryKey(category);
    if (/video|\\d+:\\d{2}/i.test(label) || categoryKey === 'videos') return 'video';
    if (categoryKey === 'streetviewand360' || categoryKey === 'streetview360') return 'streetView';
    if (/photo/i.test(label) || mapsPhotoMediaFromTile(tile)) return 'image';
    return 'unknown';
  }

  function visibleMapsPhotoItems(categoryLabel, input = {}) {
    const limit = normalizeLimit(input.photoLimit ?? input.photosLimit, 20);
    const tiles = Array.from(document.querySelectorAll('a.MIgS0d'))
      .filter(element => visibleElement(element));
    const items = tiles.map((tile, index) => {
      const sourceUrl = cleanResultUrl(tile.href) || tile.href || null;
      const mediaUrl = mapsPhotoMediaFromTile(tile);
      const dimensions = mapsPhotoDimensionsFromHref(tile.href);
      const label = cleanMapsPhotoLabel(tile.getAttribute?.('aria-label') || textOf(tile));
      return {
        id: mediaUrl ? mediaUrl.split(/[?#]/)[0] : mapsPhotoIdFromHref(tile.href),
        type: mapsPhotoTypeFromTile(tile, categoryLabel),
        url: mediaUrl,
        thumbnailUrl: mediaUrl,
        width: dimensions.width,
        height: dimensions.height,
        category: categoryLabel,
        label: label || null,
        capturedAt: null,
        authorName: null,
        authorProfileUrl: null,
        sourceUrl,
        sourceTag: null,
        rank: index + 1,
        source: {
          type: 'dom',
          position: elementScreenPosition(tile)
        }
      };
    });
    return uniqueBy(items, item => `${item.category}|${item.url || item.id || item.sourceUrl || item.rank}`, limit)
      .filter(item => item.url || item.sourceUrl || item.label);
  }

  async function extractMapsPlacePhotos(input = {}) {
    if (input.includePhotos !== true) return null;
    const opened = await openMapsPhotosPanel(input);
    if (!opened) {
      return {
        source: 'googleMaps',
        availableCategories: [],
        requestedCategories: requestedMapsPhotoCategories(input),
        categories: [],
        items: [],
        unavailable: true
      };
    }

    const availableTabs = mapsPhotoCategoryTabs();
    const availableCategories = uniqueBy(availableTabs.map(tab => tab.label), label => label.toLowerCase(), 50);
    const requestedCategories = requestedMapsPhotoCategories(input);
    const selections = selectedMapsPhotoTabs(requestedCategories, availableTabs);
    const categories = [];

    for (const selection of selections) {
      const collected = [];
      for (const tab of selection.tabs) {
        await selectMapsPhotoTab(tab, input);
        collected.push(...visibleMapsPhotoItems(selection.aggregate ? tab.label : selection.label, input));
      }
      const items = uniqueBy(collected, item => item.url || item.id || item.sourceUrl, normalizeLimit(input.photoLimit ?? input.photosLimit, 20));
      categories.push({
        label: selection.label,
        source: 'googleMapsPhotoTab',
        requested: selection.aggregate ? 'other' : selection.label,
        sourceCategories: selection.tabs.map(tab => tab.label),
        items
      });
    }

    return {
      source: 'googleMaps',
      availableCategories,
      requestedCategories,
      categories,
      items: uniqueBy(categories.flatMap(category => category.items), item => item.url || item.id || item.sourceUrl, normalizeLimit(input.photoLimit ?? input.photosLimit, 20))
    };
  }

  function mergeMapsPlace(base, detail) {
    const categories = detail.categories?.length ? detail.categories : base.categories;
    const address = detail.address || base.address;
    return {
      ...base,
      ...detail,
      title: detail.title || base.title,
      mapsUrl: detail.mapsUrl || base.mapsUrl,
      websiteUrl: detail.websiteUrl || base.websiteUrl,
      rating: {
        value: detail.rating?.value ?? base.rating?.value ?? null,
        count: detail.rating?.count ?? base.rating?.count ?? null
      },
      address,
      addressStructured: detail.addressStructured || base.addressStructured || structuredAddressFromText(address),
      primaryCategory: categories?.[0] || detail.primaryCategory || base.primaryCategory || null,
      categories: categories || [],
      priceRange: detail.priceRange || base.priceRange || null,
      currentHoursText: detail.currentHoursText || base.currentHoursText || null,
      hours: detail.hours?.length ? detail.hours : base.hours || [],
      phone: detail.phone || base.phone || null,
      photos: detail.photos || base.photos || null,
      source: {
        ...base.source,
        details: detail.source || null
      }
    };
  }

  function mergeMapsNetworkIntoPlaces(places, networkPlaces) {
    if (!Array.isArray(networkPlaces) || networkPlaces.length === 0) return places;
    return places.map(place => {
      const match = networkPlaces.find(candidate => {
        const candidatePlaceId = candidate.placeId || googleMapsPlaceIdFromUrl(candidate.mapsUrl);
        const placePlaceId = place.placeId || googleMapsPlaceIdFromUrl(place.mapsUrl);
        if (candidatePlaceId && placePlaceId && candidatePlaceId === placePlaceId) return true;
        if (candidatePlaceId && place.mapsUrl && place.mapsUrl.includes(candidatePlaceId)) return true;

        const candidateTitle = normalizeMapsIdentityText(candidate.title);
        const placeTitle = normalizeMapsIdentityText(place.title);
        if (candidateTitle && placeTitle && candidateTitle === placeTitle) return true;

        const candidateAddress = normalizeMapsIdentityText(candidate.address);
        const placeAddress = normalizeMapsIdentityText(place.address);
        if (candidateAddress && placeAddress && candidateAddress === placeAddress) return true;

        const distanceMeters = mapsLocationDistanceMeters(candidate.location, place.location);
        return distanceMeters !== null && distanceMeters <= 40;
      });
      if (!match) return place;
      const categories = match.categories?.length ? match.categories : place.categories || [];
      const address = match.address || place.address || null;
      return {
        ...place,
        placeId: match.placeId || place.placeId || googleMapsPlaceIdFromUrl(place.mapsUrl) || null,
        title: match.title || place.title || null,
        mapsUrl: match.mapsUrl || place.mapsUrl || null,
        websiteUrl: match.websiteUrl || place.websiteUrl || null,
        rating: {
          value: match.rating?.value ?? place.rating?.value ?? null,
          count: match.rating?.count ?? place.rating?.count ?? null
        },
        primaryCategory: match.primaryCategory || categories[0] || place.primaryCategory || null,
        categories,
        priceRange: match.priceRange || place.priceRange || null,
        address,
        addressStructured: match.addressStructured || place.addressStructured || structuredAddressFromText(address),
        location: match.location || place.location || null,
        currentHoursText: match.currentHoursText || place.currentHoursText || null,
        hours: match.hours?.length ? match.hours : place.hours || [],
        phone: match.phone || place.phone || null,
        photos: match.photos || place.photos || null,
        networkEvidence: {
          placeId: match.placeId,
          snippets: match.snippets || [],
          source: match.source || null
        }
      };
    });
  }

  function mapsNetworkPhotosCoverRequest(photos, input = {}) {
    if (!photos?.items?.length) return false;
    const requested = requestedMapsPhotoCategories(input).map(mapsPhotoCategoryKey).filter(Boolean);
    if (!requested.length) return true;
    return requested.every(key => key === 'all');
  }

  function mapsPlaceFromNode(node, index = 0) {
    const link = node.matches?.('a[href*="/maps/place/"]') ? node : node.querySelector?.('a[href*="/maps/place/"]');
    const text = textOf(node);
    const lines = linesOf(node);
    const parts = mapsFactParts(lines);
    const title = cleanMapsTitle(node.querySelector?.('div[role="heading"], h1, h2, h3')?.textContent?.trim()
      || link?.getAttribute?.('aria-label')
      || lines.find(line => line.length > 2 && !/^\d+(?:\.\d)?$|reviews?|open|closed|directions|website|call/i.test(line))
      || null);
    const rating = parseRatingText(text);
    const websiteLink = Array.from(node.querySelectorAll?.('a[href^="http"]') || [])
      .find(anchor => !GOOGLE_HOST_RE.test(new URL(anchor.href, location.href).hostname));
    const phone = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/)?.[0] || null;
    const categories = mapsCategoriesForPlace(parts, title);
    const priceRange = parsePriceRange(parts);
    const address = cleanMapsAddress(parts.find(isMapsAddressPart) || lines.find(isMapsAddressPart));
    const currentHoursText = currentHoursFromParts(parts);
    return {
      id: cleanResultUrl(link?.href) || `${location.href}#place-${index + 1}`,
      platform: 'googleMaps',
      type: 'place',
      rank: index + 1,
      title,
      mapsUrl: cleanResultUrl(link?.href),
      websiteUrl: websiteLink ? mapsExternalUrl(websiteLink.href) : null,
      rating,
      primaryCategory: categories[0] || null,
      categories,
      priceRange,
      address,
      addressStructured: structuredAddressFromText(address),
      currentHoursText,
      hours: [],
      phone,
      text: truncate(text, 800),
      source: { type: 'dom', position: elementScreenPosition(node) }
    };
  }

  function visibleMapsPlaces(limit = 20) {
    const nodes = Array.from(document.querySelectorAll([
      'div[role="feed"] div[role="article"]',
      'div.Nv2PK',
      'a[href*="/maps/place/"]',
      'a[href*="/maps?cid="]',
      'a[href*="cid="]'
    ].join(', ')))
      .map(node => node.closest?.('div[role="article"], div.Nv2PK') || node)
      .filter(Boolean);
    return uniqueBy(nodes.map((node, index) => mapsPlaceFromNode(node, index)), item => item.mapsUrl || item.title, normalizeLimit(limit, 20, 100))
      .filter(place => place.title || place.mapsUrl);
  }

  function linkForMapsPlace(place) {
    const anchors = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
    return anchors.find(anchor => cleanResultUrl(anchor.href) === place.mapsUrl)
      || anchors.find(anchor => cleanMapsTitle(anchor.getAttribute('aria-label') || '') === place.title)
      || anchors.find(anchor => textOf(anchor).includes(place.title))
      || null;
  }

  function mapsDetailMatchesPlace(detail, place) {
    if (!detail || /^Results$/i.test(detail.title || '')) return false;
    if (!place?.title) return true;
    return String(detail.title || '').toLowerCase() === String(place.title).toLowerCase()
      || String(detail.text || '').toLowerCase().includes(String(place.title).toLowerCase());
  }

  async function openMapsPlaceDetail(place, input = {}) {
    const link = linkForMapsPlace(place);
    if (!link) return null;
    link.click?.();
    const timeoutMs = normalizeDurationMs(input.detailTimeoutMs, 4000, 30000);
    const intervalMs = normalizeDurationMs(input.detailPollMs, 200, 2000);
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      if (mapsDetailMatchesPlace(mapsDetailFromCurrentPage(input), place)) break;
    }
    return mapsDetailFromCurrentPageWithHours(input);
  }

  async function enrichMapsPlacesWithDetails(places, input = {}) {
    if (input.includeDetails === false) return places;
    const detailLimit = normalizeLimit(input.detailLimit ?? input.detailsLimit, Math.min(places.length, 5), 20);
    const output = [];
    for (const place of places) {
      if (output.length >= detailLimit) {
        output.push(place);
        continue;
      }
      const detail = await openMapsPlaceDetail(place, input);
      output.push(detail ? mergeMapsPlace(place, detail) : place);
    }
    return output;
  }

  async function waitForMapsResults(input = {}) {
    const timeoutMs = normalizeDurationMs(input.resultsTimeoutMs ?? input.timeoutMs, 10000, 30000);
    const intervalMs = normalizeDurationMs(input.resultsPollMs, 300, 2000);
    const startedAt = Date.now();
    let placeCount = 0;
    let emptyState = mapsEmptyState();
    while (Date.now() - startedAt < timeoutMs) {
      placeCount = visibleMapsPlaces(5).length || (mapsDetailFromCurrentPage(input) ? 1 : 0);
      emptyState = mapsEmptyState();
      if (placeCount > 0 || emptyState.empty) break;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return {
      placeCount,
      emptyState,
      waitedMs: Date.now() - startedAt,
      timedOut: placeCount === 0 && !emptyState.empty
    };
  }

  async function extractMapsResults(input = {}) {
    if (input.scroll === true || input.loadAll === true) {
      const feed = document.querySelector('div[role="feed"]');
      const maxScrolls = normalizeLimit(input.maxScrolls, 3, 20);
      for (let index = 0; index < maxScrolls; index += 1) {
        if (feed) feed.scrollBy({ top: Math.round(window.innerHeight * 0.8), behavior: 'auto' });
        else window.scrollBy({ top: Math.round(window.innerHeight * 0.8), behavior: 'auto' });
        await new Promise(resolve => setTimeout(resolve, normalizeDurationMs(input.scrollWaitMs, 700, 5000)));
      }
    }
    const network = input.includeNetwork === false ? null : extractGoogleMapsNetworkObjects({
      ...input,
      limit: input.networkPlaceLimit ?? input.limit,
      networkEntryLimit: input.networkEntryLimit ?? 30
    });
    const limit = normalizeLimit(input.limit, 20, 100);
    const directDetail = mapsDetailFromCurrentPage(input);
    const domPlaces = visibleMapsPlaces(limit);
    const basePlaces = uniqueBy(
      [
        ...(directDetail ? [directDetail] : []),
        ...domPlaces
      ],
      place => place.mapsUrl || place.placeId || place.title,
      limit
    );
    const places = uniqueBy(
      mergeMapsNetworkIntoPlaces(
        await enrichMapsPlacesWithDetails(basePlaces, input),
        network?.places || []
      ),
      place => place.placeId || googleMapsPlaceIdFromUrl(place.mapsUrl) || place.mapsUrl || normalizeMapsIdentityText(place.title),
      limit
    );
    const emptyState = mapsEmptyState();
    return {
      id: 'googleMaps',
      query: currentQuery() || input.query || input.keywords || null,
      url: location.href,
      places,
      count: places.length,
      networkEvidence: network ? {
        recorder: network.recorder,
        places: network.places.slice(0, normalizeLimit(input.networkPlaceLimit ?? input.limit, 10, 50)),
        entries: network.entries.slice(0, normalizeLimit(input.networkEntryLimit, 10, 50))
      } : null,
      empty: places.length === 0 && emptyState.empty,
      emptyState,
      nextActions: ['extractMapsResults', 'extractGoogleMapsNetworkEvidence']
    };
  }

  async function researchGoogleMaps(input = {}) {
    if ((input.query || input.keywords) && input.navigate !== false && !/\/maps\//i.test(location.pathname)) {
      return { ...(searchMaps(input)), nextAction: 'researchGoogleMaps', nextInput: { ...input, navigate: false } };
    }
    const resultWait = /\/maps\//i.test(location.pathname) ? await waitForMapsResults(input) : null;
    const evidence = await extractMapsResults(input);
    return {
      id: 'googleMaps',
      query: evidence.query,
      url: location.href,
      places: evidence.places,
      count: evidence.count,
      empty: evidence.empty,
      emptyState: evidence.emptyState,
      resultWait,
      evidence
    };
  }

  async function researchGoogleMapsPlace(input = {}) {
    if ((input.url || input.mapsUrl || input.placeUrl || input.placeId || input.query || input.name || input.title || input.keywords) && input.navigate !== false) {
      return openMapsPlace(input);
    }

    const resultWait = /\/maps\//i.test(location.pathname) ? await waitForMapsResults({ ...input, limit: 1 }) : null;
    const network = input.includeNetwork === false ? null : extractGoogleMapsNetworkObjects({
      ...input,
      limit: input.networkPlaceLimit ?? 10,
      networkEntryLimit: input.networkEntryLimit ?? 30
    });
    const listPlaces = visibleMapsPlaces(1);
    const directDetail = await mapsDetailFromCurrentPageWithHours(input);
    const candidate = directDetail && listPlaces[0] ? mergeMapsPlace(listPlaces[0], directDetail) : directDetail || listPlaces[0] || null;
    let enriched = candidate
      ? mergeMapsNetworkIntoPlaces(
          await enrichMapsPlacesWithDetails([candidate], { ...input, detailLimit: 1 }),
          network?.places || []
        )[0]
      : null;
    const detailUrl = location.href;
    if (enriched && input.includePhotos === true) {
      const photos = mapsNetworkPhotosCoverRequest(enriched.photos, input)
        ? enriched.photos
        : await extractMapsPlacePhotos(input);
      enriched = { ...enriched, photos };
    }

    return {
      id: 'googleMapsPlace',
      query: currentQuery() || input.query || input.keywords || input.name || input.title || null,
      url: detailUrl,
      place: enriched,
      found: Boolean(enriched),
      resultWait,
      networkEvidence: network ? {
        recorder: network.recorder,
        places: network.places.slice(0, normalizeLimit(input.networkPlaceLimit, 5, 50)),
        entries: network.entries.slice(0, normalizeLimit(input.networkEntryLimit, 10, 50))
      } : null
    };
  }

  function openResult(input = {}) {
    if (!isResultsPage()) throw new Error('Current page is not a Google results page.');

    const bucket = normalizeBucket(input.bucket);
    const rank = Math.max(1, Number(input.rank || input.index + 1 || 1));
    const listings = scanListings({
      ...input,
      organicLimit: Math.max(rank, Number(input.organicLimit || input.limit || 10)),
      sponsoredLimit: Math.max(rank, Number(input.sponsoredLimit || 10)),
      imageLimit: Math.max(rank, Number(input.imageLimit || 10)),
      videoLimit: Math.max(rank, Number(input.videoLimit || 10)),
      shortVideoLimit: Math.max(rank, Number(input.shortVideoLimit || 10)),
      discussionLimit: Math.max(rank, Number(input.discussionLimit || 10)),
      newsLimit: Math.max(rank, Number(input.newsLimit || 10)),
      aiOverviewLimit: Math.max(rank, Number(input.aiOverviewLimit || 10)),
      otherLimit: Math.max(rank, Number(input.otherLimit || 10)),
      includeAiOverview: bucket === 'aiOverview' || bucket === 'all' || input.includeAiOverview !== false,
      includeOther: input.includeOther === true || bucket === 'other' || bucket === 'all'
    });

    const sources = {
      organic: listings.organicResults,
      sponsored: listings.sponsoredResults,
      image: listings.imageResults,
      video: listings.videoResults,
      shortVideo: listings.shortVideoResults,
      discussion: listings.discussionResults,
      news: listings.newsResults,
      aiOverview: listings.aiOverviewResults,
      other: listings.otherResults,
      all: listings.allResults
    };
    const source = sources[bucket] || listings.organicResults;
    const result = source[rank - 1];
    if (!result) throw new Error(`${bucket} result rank ${rank} not found.`);

    location.assign(result.url);
    return {
      opened: true,
      bucket,
      rank,
      result
    };
  }

  function readGoogleCollections() {
    try {
      return JSON.parse(sessionStorage.getItem(GOOGLE_COLLECTIONS_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function writeGoogleCollections(collections) {
    sessionStorage.setItem(GOOGLE_COLLECTIONS_KEY, JSON.stringify(collections || {}));
  }

  function googleCollectionId(input = {}) {
    return String(input.collectionId || input.taskId || input.name || 'default').trim() || 'default';
  }

  function ensureGoogleCollection(input = {}) {
    const collections = readGoogleCollections();
    const id = googleCollectionId(input);
    const now = new Date().toISOString();
    const collection = input.reset === true || !collections[id] ? {
      id,
      platform: 'google',
      task: input.task || input.taskName || null,
      createdAt: now,
      updatedAt: now,
      contexts: [],
      records: []
    } : collections[id];
    collections[id] = collection;
    writeGoogleCollections(collections);
    return { collections, collection };
  }

  function googleRecordKey(record = {}) {
    return record.url || `${record.bucket || record.type || 'result'}:${record.title || record.text || record.description || ''}`;
  }

  function googleCollectionSummary(collection) {
    return {
      id: collection?.id || null,
      platform: 'google',
      task: collection?.task || null,
      createdAt: collection?.createdAt || null,
      updatedAt: collection?.updatedAt || null,
      recordsStored: collection?.records?.length || 0,
      contextsStored: collection?.contexts?.length || 0,
      currentUrl: location.href
    };
  }

  function mergeGoogleRecords(collection, records, input = {}, context = {}) {
    const maxRecords = normalizeLimit(input.maxRecords ?? input.collectionMaxRecords, 1000, 3000);
    const byKey = new Map((collection.records || []).map(record => [googleRecordKey(record), record]).filter(([key]) => key));
    let added = 0;
    let updated = 0;
    const now = new Date().toISOString();
    for (const record of records || []) {
      const key = googleRecordKey(record);
      if (!key) continue;
      const compact = { ...record, collectedAt: record.collectedAt || now, lastSeenUrl: location.href };
      if (byKey.has(key)) {
        byKey.set(key, { ...byKey.get(key), ...compact, updatedAt: now });
        updated += 1;
      } else {
        byKey.set(key, compact);
        added += 1;
      }
    }
    collection.records = [...byKey.values()].slice(-maxRecords);
    collection.updatedAt = now;
    collection.contexts = (collection.contexts || []).concat({
      url: location.href,
      query: currentQuery(),
      vertical: currentVertical(),
      capturedAt: now,
      added,
      updated,
      ...context
    }).slice(-100);
    return { added, updated, total: collection.records.length };
  }

  function filterGoogleRecords(records, input = {}) {
    const terms = []
      .concat(input.keyword ? [input.keyword] : [])
      .concat(input.keywords || [])
      .concat(input.phrases || [])
      .map(value => String(value).toLowerCase().trim())
      .filter(Boolean);
    const bucket = input.bucket || input.type || input.category || null;
    return (records || []).filter(record => {
      if (bucket && bucket !== 'all' && record.bucket !== bucket && record.type !== bucket) return false;
      if (!terms.length) return true;
      const haystack = [record.title, record.text, record.description, record.source, record.url].filter(Boolean).join(' ').toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
  }

  function sortGoogleRecords(records, input = {}) {
    const sortBy = input.sortBy || input.orderBy || 'rank';
    const direction = input.direction === 'asc' ? 1 : -1;
    const value = record => {
      if (sortBy === 'date') return record.date ? Date.parse(record.date) || 0 : 0;
      if (sortBy === 'bucket') return String(record.bucket || record.type || '').charCodeAt(0) || 0;
      return -(record.rank || record.absoluteRank || 0);
    };
    return [...records].sort((a, b) => direction * (value(a) - value(b)));
  }

  function googleRecordsFromResults(results) {
    return [
      ['organic', results.organicResults],
      ['sponsored', results.sponsoredResults],
      ['image', results.imageResults],
      ['video', results.videoResults],
      ['shortVideo', results.shortVideoResults],
      ['discussion', results.discussionResults],
      ['news', results.newsResults],
      ['aiOverview', results.aiOverviewResults],
      ['other', results.otherResults]
    ].flatMap(([bucket, items]) => (items || []).map(item => ({ ...item, bucket, platform: 'google' })));
  }

  function startGoogleCollection(input = {}) {
    const { collection } = ensureGoogleCollection({ ...input, reset: input.reset !== false });
    return { id: 'google', collection: googleCollectionSummary(collection), nextActions: ['collectGoogleResults', 'queryGoogleCollection', 'clearGoogleCollection'] };
  }

  function collectGoogleResults(input = {}) {
    const { collections, collection } = ensureGoogleCollection(input);
    const results = extractResults(input);
    const records = googleRecordsFromResults(results);
    const merge = mergeGoogleRecords(collection, records, input, { counts: results.counts, resultStats: results.resultStats });
    collections[collection.id] = collection;
    writeGoogleCollections(collections);
    return {
      id: 'google',
      url: location.href,
      collection: googleCollectionSummary(collection),
      merge,
      sourceCounts: results.counts,
      records: input.includeRecords === true ? queryGoogleCollection({ ...input, limit: input.limit || 50 }).records : undefined,
      nextActions: ['search', 'collectGoogleResults', 'queryGoogleCollection', 'clearGoogleCollection']
    };
  }

  function queryGoogleCollection(input = {}) {
    const collections = readGoogleCollections();
    const id = googleCollectionId(input);
    const collection = collections[id];
    if (!collection) throw new Error(`Google collection not found: ${id}`);
    const limit = normalizeLimit(input.limit, 25, 500);
    const records = sortGoogleRecords(filterGoogleRecords(collection.records, input), input).slice(0, limit);
    return { id: 'google', collection: googleCollectionSummary(collection), records, selectedCount: records.length };
  }

  function clearGoogleCollection(input = {}) {
    const collections = readGoogleCollections();
    if (input.all === true) {
      writeGoogleCollections({});
      return { id: 'google', cleared: 'all', remainingCollections: 0 };
    }
    const id = googleCollectionId(input);
    const existed = Boolean(collections[id]);
    delete collections[id];
    writeGoogleCollections(collections);
    return { id: 'google', cleared: id, existed, remainingCollections: Object.keys(collections).length };
  }

  window.AiChromeRemote?.registerAdapter({
    id: 'google',
    matches: ['https://www.google.com/*', 'https://google.com/*', 'https://maps.google.com/*'],
    actions: {
      getSearchState,
      search,
      extractResults,
      searchMaps,
      openMapsPlace,
      extractGoogleMapsNetworkEvidence,
      extractMapsResults,
      researchGoogleMaps,
      researchGoogleMapsPlace,
      openResult,
      startGoogleCollection,
      collectGoogleResults,
      queryGoogleCollection,
      clearGoogleCollection
    }
  });
})();
