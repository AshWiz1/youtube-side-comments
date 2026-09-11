/**
 * Bootstrap.
 *
 * MV3 content scripts cannot be ES modules and we have no build step, so the
 * real code loads as modules at runtime. The consequence worth knowing: these
 * files are reachable from the page, which is why they hold logic only and
 * never anything sensitive.
 */
(async () => {
  const [{ decide }, { createAdapter }] = await Promise.all([
    import(chrome.runtime.getURL('src/engine.js')),
    import(chrome.runtime.getURL('src/adapter.js')),
  ]);

  const adapter = createAdapter(document);
  // The user's stored preference arrives with the popup; until then, on.
  const prefs = { enabled: true };

  const run = () => adapter.apply(decide(adapter.readState(prefs)));

  run();
  window.addEventListener('yt-navigate-finish', run);
})();
