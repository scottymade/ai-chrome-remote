# Site Adapter Example

The `sites/example` folder shows the smallest complete site adapter:

- `site.json` grants URL matches and documents the intended actions.
- `adapter.js` runs in the page context after the generic agent and registers actions with `window.AiChromeRemote.registerAdapter`.

Real site support should usually be built on a feature branch by adding a new `sites/<site-id>` folder or extending an existing allowlist-only folder.
