/**
 * Bootstrap.
 *
 * MV3 content scripts cannot be ES modules and we have no build step, so the
 * real code loads as modules at runtime. The consequence worth knowing: these
 * files are reachable from the page, which is why they hold logic only and
 * never anything sensitive.
 */
(async () => {
  const [{ decide, ACTION, REASON }, { createAdapter }] = await Promise.all([
    import(chrome.runtime.getURL('src/engine.js')),
    import(chrome.runtime.getURL('src/adapter.js')),
  ]);

  const adapter = createAdapter(document);
  // The user's stored preference arrives with the popup; until then, on.
  const prefs = { enabled: true };

  const run = () => {
    const decision = decide(adapter.readState(prefs));
    adapter.apply(decision);
    // YouTube builds a Watch Page asynchronously, so a run that lands before
    // the Comments exist is *early*, not unrecognised. Retrying that one reason
    // keeps a slow load from Stepping Aside on a page that was merely young.
    return decision.action === ACTION.APPLY || decision.reason !== REASON.UNRECOGNISED_STRUCTURE;
  };

  const settle = (deadline) => {
    if (run() || Date.now() >= deadline) return;
    setTimeout(settle, 250, deadline);
  };

  // `yt-navigate-finish` fires on both a cold load and an in-page navigation,
  // so one listener covers arriving at a Watch Page either way.
  const start = () => settle(Date.now() + 10_000);

  start();
  window.addEventListener('yt-navigate-finish', start);
})();
