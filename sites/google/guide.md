# Google Search Adapter Guide

Read this guide before remote-controlling Google Search through the `google` adapter.

## Scope

This adapter extracts structured data from the rendered Google Search results page. It should be used instead of parsing Google network traffic. Google-specific parsing, ranking, URL cleanup, and result categorization live in `sites/google/adapter.js`.

The adapter only reports results that are present in the loaded page DOM. Scroll and extract again when more visible results are needed.

## Actions

### `getSearchState`

Returns the current page state, query, result stats, counts, category previews, and suggestions.

Use this to confirm that Google is on a results page and the adapter is loaded.

### `search`

Navigates Google Search to a query.

Example:

```json
{
  "query": "crm software",
  "vertical": "all"
}
```

Optional fields:

- `vertical`: Which Google results page to open. Supported values: `all`, `images`, `videos`, `forums`, `news`, `shortVideos`, and `web`.
- `page` or `category`: Alias for `vertical`.
- `num`: Requested results/page size when Google honors it.
- `start`: Zero-based result offset for pagination when Google honors it.
- `udm`: Raw Google vertical parameter override for debugging.
- `tbm`: Raw Google vertical parameter override for debugging.

Prefer `vertical` over raw Google URL parameters. The adapter maps the supported verticals to the current Google tab parameters:

- `all`: no vertical parameter.
- `images`: `udm=2`.
- `videos`: `udm=7`.
- `forums`: `udm=18`.
- `news`: `tbm=nws`.
- `shortVideos`: `udm=39`.
- `web`: `udm=14`.

### `extractResults`

Extracts categorized search results from the rendered page.

Example:

```json
{
  "organicLimit": 10,
  "sponsoredLimit": 10,
  "imageLimit": 10,
  "videoLimit": 10,
  "shortVideoLimit": 10,
  "discussionLimit": 10,
  "newsLimit": 10,
  "aiOverviewLimit": 10,
  "otherLimit": 10,
  "includeOther": true,
  "questionLimit": 10,
  "relatedSearchLimit": 10,
  "scanLimit": 80
}
```

AI Overview extraction is enabled by default. Pass `"includeAiOverview": false` only when you intentionally want to skip AI Overview text and citations.

### `researchGoogleMaps`

Opens or extracts from Google Maps and returns ranked place records. Use this for keyword, dish, category, neighborhood, venue, competitor, address, rating/review, category, hours, phone, website, and Maps listing research. Broad searches return `places[]`; pass `detailLimit` to control how many visible results are opened and enriched.

Example:

```json
{
  "query": "coffee roasters",
  "location": "Carlsbad, CA",
  "limit": 20,
  "scroll": true
}
```

Primary output fields:

- `places`: Ranked Google Maps place records. Each record may include DOM card evidence, detail-panel fields, and network-derived metadata.
- `count`: Number of place records returned.
- `empty` and `emptyState`: True empty-state detection when Maps reports no results.
- `resultWait`: Whether the adapter waited for cards or an empty state.

For one known listing, use `researchGoogleMapsPlace` with `url`, `mapsUrl`, `placeUrl`, `placeId`, or a precise `query`. It returns a single `place` object instead of an array.

Google Maps listing photos are optional because they add navigation time and payload size. Pass `includePhotos: true` to open the listing's Photos panel and return Google-provided photo tab categories. If `photoCategories` is omitted, the adapter collects the `All` tab only. Broad category requests include `All`, `Latest`, `Videos`, `Menu`, `Food`, `Food & drink`, `Vibe`, `Inside`, `Exterior`, `Rooms`, `Amenities`, `By owner`, `From visitors`, `Street View & 360`, and `Other`; `Other` aggregates source tabs that are specific to a place such as dish names, hairstyles, exhibits, or landmarks. These labels come from Google Maps photo tabs and are not inferred by the adapter.

Lower-level actions are `searchMaps`, `openMapsPlace`, and `extractMapsResults`. Prefer `researchGoogleMaps` or `researchGoogleMapsPlace` when using the adapter through an MCP tool.

`extractGoogleMapsNetworkEvidence` inspects captured Maps XHR/fetch payloads such as `/search?tbm=map` and `/maps/preview/lp`. Use it after opening or clicking Maps results when the DOM cards are too shallow. The output includes endpoint counts, compact network entries, and `placeCandidates` with place IDs, names, coordinates, ratings when parseable, websites, categories, snippets, and possible popular/review mentions.

Primary output fields:

- `counts`: Count of each category.
- `categories`: Results grouped by category.
- `vertical`: Detected Google results page: `all`, `images`, `videos`, `forums`, `news`, `shortVideos`, or `web`.
- `aiOverview`: AI Overview answer text and cited links when the section is visible.
- `suggestions`: Non-result suggestions, such as People Also Ask.
- `allResults`: Ordered SERP list across standard result categories. AI Overview citations are kept in `aiOverview.links` and `categories.aiOverview`.
- `results`: Backward-compatible alias for `organicResults`.

Result categories:

- `sponsored`: Ads and sponsored results.
- `organic`: Standard web results.
- `images`: Image results from the Images vertical.
- `videos`: Video results, including YouTube watch URLs when visible.
- `shortVideos`: Short-form video results, including YouTube Shorts when visible.
- `discussions`: Forum, Reddit, social, and "what people are saying" style results.
- `news`: News results from the News vertical, plus best-effort top-stories/news modules when visible on the All page.
- `aiOverview`: AI Overview source/citation links when visible.
- `other`: Uncategorized results, only when `includeOther` is true.

AI Overview output:

- `present`: Whether the AI Overview section is visible in the rendered page.
- `text`: Combined visible AI Overview answer text, excluding cited link cards and controls.
- `lines`: The visible answer text split into page-order lines.
- `links`: Source/citation links suggested by the AI Overview, using the same metadata shape as result objects.

## Vertical Search

For reliable collection from a specific Google tab, run `search` with `vertical`, wait for the tab to load, then run `extractResults` on that page.

Examples:

```json
{ "query": "crm software", "vertical": "news" }
```

```json
{ "query": "crm software", "vertical": "forums" }
```

```json
{ "query": "crm software", "vertical": "shortVideos" }
```

The All page can contain mixed modules such as AI Overview, video carousels, discussions, and top stories. The adapter still categorizes those visible modules, but it does not treat mixed modules like "What people are saying" as news. That section is classified as `discussions`. Use the News vertical when the goal is news.

## Pagination

The adapter extracts the currently loaded Google results page only. To collect multiple pages, load each page URL, wait for the page agent to be ready, then run `extractResults` for that page.

Google Search uses `start` as the zero-based result offset and `num` as the requested page size. For a 10-result page size:

- Page 1: `https://www.google.com/search?q=crm+software&num=10&start=0`
- Page 2: `https://www.google.com/search?q=crm+software&num=10&start=10`
- Page 3: `https://www.google.com/search?q=crm+software&num=10&start=20`

When building a multi-page catalog:

- Store the requested `page`, `start`, and `num` alongside every extraction.
- Treat result ranks from the adapter as page-local ranks.
- Compute global organic rank as `start + organicRank` when `num=10` and `start` matches the requested offset.
- Keep category ranks separate. A page can contain ads, videos, discussions, AI Overview citations, or other modules before or between organic results.
- De-duplicate across pages by normalized URL plus title when producing a keyword-level catalog, because Google can repeat results or modules.
- Expect AI Overview to usually appear on page 1 only. If it appears on another page, store it with that page's extraction rather than merging it into organic ranks.

Recommended multi-page sequence:

1. Use `chrome_remote_open_url` with the page URL for `start=0`.
2. Use `chrome_remote_tab_status` until the page agent is ready.
3. Use `chrome_remote_run_adapter_action` with `action: "extractResults"`.
4. Repeat the same sequence for `start=10`, `start=20`, and later offsets as needed.
5. Combine the returned page objects in the caller, preserving each page's `query`, `url`, `resultStats`, `counts`, `categories`, `aiOverview`, and `suggestions`.

For token-efficient multi-page work, use a temporary collection instead of keeping each extraction in model context:

1. Run `startGoogleCollection` with `query`, `vertical`, and an optional `collectionId`.
2. Load each Google page or vertical, then run `collectGoogleResults`. It calls `extractResults`, stores compact result records, and returns a collection summary.
3. Run `queryGoogleCollection` with `sortBy`, `type`, `keyword`, `limit`, or `offset` to retrieve only the subset needed for analysis.
4. Run `clearGoogleCollection` when the research task is done.

Example:

```json
{ "action": "startGoogleCollection", "input": { "query": "crm software", "vertical": "all" } }
```

```json
{ "action": "collectGoogleResults", "input": { "collectionId": "google:crm-software", "page": 1 } }
```

```json
{ "action": "queryGoogleCollection", "input": { "collectionId": "google:crm-software", "type": "organic", "limit": 20 } }
```

Each result includes:

- `serpRank`: Position in the mixed visible SERP extraction.
- A category-specific rank, such as `organicRank`, `sponsoredRank`, or `videoRank`.
- `type`, `title`, `url`, `displayUrl`, and `description`.
- URL/source fields: `source`, `host`, `domain`, and `path`.
- Page-visible metadata fields when available: `date`, `duration`, `thumbnailUrl`, and `visibleMetadata`.
- Image fields when available: `imageUrl` and `thumbnailUrl`.
- Video fields when available: `platform`, `channel`, `date`, `duration`, and `thumbnailUrl`.

### `openResult`

Opens a result by category and rank.

Example:

```json
{
  "bucket": "organic",
  "rank": 1
}
```

Supported buckets:

- `organic`
- `sponsored`
- `image`
- `video`
- `shortVideo`
- `discussion`
- `news`
- `aiOverview`
- `other`
- `all`

## Recommended Workflow

1. Use `chrome_remote_open_url` to open `https://www.google.com/` or a search URL.
2. Use `chrome_remote_run_adapter_action` with `action: "search"` to submit a keyword.
3. Use `chrome_remote_tab_status` until the page agent is ready.
4. Use `chrome_remote_run_adapter_action` with `action: "extractResults"`.
5. Read `categories` for bucketed results and `allResults` for mixed SERP order.
6. Scroll with `chrome_remote_scroll` and extract again if deeper visible results are needed.
7. Use `openResult` only after selecting a category and rank from extracted data.

## Notes

Google results vary by account, location, time, personalization, viewport, and loaded page state. Treat extracted data as a point-in-time observation, not a stable database.

Do not add Google-specific parsing to shared MCP, native-host, or extension infrastructure. Keep site behavior inside this folder so the site adapter remains drop-in and independently maintainable.
