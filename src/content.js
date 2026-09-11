/**
 * Bootstrap.
 *
 * MV3 content scripts cannot be ES modules and we have no build step, so the
 * real code loads as modules at runtime. The consequence worth knowing: these
 * files are reachable from the page, which is why they hold logic only and
 * never anything sensitive.
 */
(async () => {
  const [{ decide, resolvePaneWidth, ACTION, REASON }, { createAdapter }, { createSplitter }] =
    await Promise.all([
      import(chrome.runtime.getURL('src/engine.js')),
      import(chrome.runtime.getURL('src/adapter.js')),
      import(chrome.runtime.getURL('src/splitter.js')),
    ]);

  /** One global width, deliberately: a setting, not a per-video chore. */
  const PANE_WIDTH_KEY = 'paneWidth';
  // Absent if the extension were loaded without the storage permission, which
  // must not cost the whole layout.
  const store = chrome.storage?.local;

  // The user's stored preference arrives with the popup; until then, on.
  const prefs = { enabled: true, paneWidth: null };
  let last = null;
  let watching = false;

  const splitter = createSplitter({
    doc: document,
    // Pointer and keyboard both resolve through the engine's own clamp — the
    // same function `decide` uses — so the two cannot disagree about the limits.
    resolve: (requested) => resolvePaneWidth(requested, adapter.containerWidth()),
    getWidth: () => adapter.paneWidth(),
    onResize: (width) => {
      // Kept in step with the Pane as it moves, so a re-decide mid-drag agrees
      // with what is already on screen instead of snapping it back.
      prefs.paneWidth = width;
      adapter.setPaneWidth(width);
    },
    onCommit: (width) => {
      store?.set({ [PANE_WIDTH_KEY]: width });
    },
  });
  const adapter = createAdapter(document, { splitter: splitter.handle });

  const run = (force) => {
    const decision = decide(adapter.readState(prefs));
    // Deciding is cheap; arranging is not. Acting only when the decision
    // actually changes keeps a run of resizes — or the Splitter's own drag —
    // from moving the Comments over and over, which would drop the reader's
    // place in the thread for no reason.
    //
    // The width is part of that comparison, and has to be: a width change is the
    // one decision the page makes without any of the others changing, so a
    // comparison that looks only at the action would leave the Pane at a width
    // the engine no longer agrees with — after a restart, after the container
    // narrows under it, or after anything else moves the ceiling.
    if (
      force ||
      decision.action !== last?.action ||
      decision.reason !== last?.reason ||
      decision.paneWidth !== last?.paneWidth
    ) {
      adapter.apply(decision);
    }
    last = decision;
    // YouTube's watch root does not exist until it has built one, so keep
    // asking: a page that arrives late must still be watched for mode changes.
    watching ||= adapter.observeModes(() => run(false));
    // YouTube builds a Watch Page asynchronously, so a run that lands before
    // the Comments exist is *early*, not unrecognised. Retrying that one reason
    // keeps a slow load from Stepping Aside on a page that was merely young.
    return decision.action === ACTION.APPLY || decision.reason !== REASON.UNRECOGNISED_STRUCTURE;
  };

  const settle = (deadline) => {
    if (run(true) || Date.now() >= deadline) return;
    setTimeout(settle, 250, deadline);
  };

  // `yt-navigate-finish` fires on both a cold load and an in-page navigation,
  // so one listener covers arriving at a Watch Page either way.
  const start = () => settle(Date.now() + 10_000);

  // Read before the first decision, so the Pane is never briefly arranged at a
  // width the reader did not choose and then corrected.
  const stored = store ? await store.get(PANE_WIDTH_KEY).catch(() => null) : null;
  // Whether the stored value is usable is the engine's call, not ours.
  prefs.paneWidth = stored?.[PANE_WIDTH_KEY] ?? null;

  start();
  window.addEventListener('yt-navigate-finish', start);

  // A window that narrows far enough for YouTube to collapse to one column has
  // to Step Aside — the Comment Pane lives in the rail YouTube is hiding, which
  // is exactly how the Comments silently disappear. The Adapter marks the
  // resizes it dispatches, so its own resync cannot re-enter here.
  window.addEventListener('resize', (event) => {
    if (!event.ysc) run(false);
  });
  // A resize is not enough on its own: YouTube answers one in its own time, and
  // fullscreen has no attribute at all. So the extension also listens to
  // YouTube changing its own mind, and to the document going fullscreen.
  document.addEventListener('fullscreenchange', () => run(false));
})();
