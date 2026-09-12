/**
 * Bootstrap.
 *
 * MV3 content scripts cannot be ES modules and we have no build step, so the
 * real code loads as modules at runtime. The consequence worth knowing: these
 * files are reachable from the page, which is why they hold logic only and
 * never anything sensitive.
 */
(async () => {
  const [
    { decide, needsArranging, resolvePaneWidth, ACTION, REASON },
    { createAdapter },
    { createSplitter },
    { createToggle },
  ] = await Promise.all([
    import(chrome.runtime.getURL('src/engine.js')),
    import(chrome.runtime.getURL('src/adapter.js')),
    import(chrome.runtime.getURL('src/splitter.js')),
    import(chrome.runtime.getURL('src/toggle.js')),
  ]);

  /** One global width, deliberately: a setting, not a per-video chore. */
  const PANE_WIDTH_KEY = 'paneWidth';
  /** The off switch, which is one global preference too — set from inside the
   *  Comment Pane, and cleared from the toolbar surface that replaces it. */
  const ENABLED_KEY = 'enabled';
  // Absent if the extension were loaded without the storage permission, which
  // must not cost the whole layout.
  const store = chrome.storage?.local;

  // Replaced by the stored preferences below, before the first decision is
  // taken; until then, on.
  const prefs = { enabled: true, paneWidth: null };
  /**
   * The decision the arrangement standing on the page was made from, or `null`
   * when there is none. It is cleared wherever the arrangement stops being ours
   * — a teardown, or a page that has just been built — so it is never a claim
   * about a page it was not made for, and the next decision always lands.
   */
  let last = null;
  /**
   * Which page's lifecycle we are in. Teardown and re-application both move it
   * on, so an attempt left over from the page being left behind is abandoned
   * rather than landing on the page being built.
   */
  let life = 0;

  const splitter = createSplitter({
    doc: document,
    // Pointer and keyboard both resolve through the engine's own clamp — the
    // same function `decide` uses, given the same two measurements — so the two
    // cannot disagree about the limits.
    resolve: (requested) => resolvePaneWidth(requested, adapter.containerWidth(), adapter.columnChrome()),
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
  const toggle = createToggle({
    doc: document,
    // The reader, in the Pane, asking for the Native Layout. The preference is
    // the whole of what this does: the page is then re-decided like any other,
    // and the off switch lands in the Adapter's one Step Aside branch — which is
    // what ticket 02's "the manual off switch routes through the same path as
    // every automatic trigger" means in code.
    onOff: () => {
      prefs.enabled = false;
      store?.set({ [ENABLED_KEY]: false });
      run();
    },
    // What the Pane's status view is told: the same two markers the toolbar
    // surface reads, and the stored preference — so both render the one decision
    // the engine makes from them, through the one function that makes it.
    read: () => ({
      enabled: prefs.enabled,
      applied: document.documentElement.dataset.ysc === 'on',
      reason: document.documentElement.dataset.yscReason || null,
      width: adapter.paneWidth(),
    }),
  });
  const adapter = createAdapter(document, { splitter: splitter.handle, toggle: toggle.handle });

  const run = () => {
    const decision = decide(adapter.readState(prefs));
    // Whether to arrange at all is the engine's call, and it is one: a page
    // that carries no arrangement of ours is arranged whatever the decision
    // says, and one that already carries what the decision asks for is left
    // alone. `last` is remembered only when the page is really left matching
    // the decision, so a page that was not ready to be arranged is asked again
    // rather than recorded as arranged.
    if (needsArranging(last, decision)) last = adapter.apply(decision) ? decision : null;
    // YouTube's watch root does not exist until it has built one, so keep
    // asking — and keep following it, because YouTube replaces its watch roots
    // between videos and an observer left behind hears nothing.
    adapter.observeModes(() => run());
    // And keep following the Comments region for the same reason, on top of
    // asking: YouTube builds its comment section into the region in its own
    // time — later in a background tab than in front of a reader — and that
    // build is the answer this decision waits for. An observer hears it whenever
    // it lands; the asking above only lasts as long as its window does.
    adapter.observeComments(() => run());
    // And the related list, for the reason the Comments region is followed:
    // YouTube builds it in its own time, and which of the two arrives first is a
    // race — measured, the Comments can be ready while the list is not. A page
    // arranged then carries the Comments in the Pane, the list still in the rail
    // and an empty Strip, and the decision after it is the same decision, so
    // nothing would re-apply: the arrangement standing on the page was made
    // without the list, and a list that has since arrived is not the one it was
    // made with. Forgetting it is what lets the next decision land.
    adapter.observeRelated(() => {
      last = null;
      run();
    });
    // YouTube builds a Watch Page asynchronously, so a run that lands before
    // the Comments exist is *early*, not unrecognised. Retrying that one reason
    // keeps a slow load from Stepping Aside on a page that was merely young.
    if (decision.action === ACTION.APPLY) return !needsArranging(last, decision);
    return decision.reason !== REASON.UNRECOGNISED_STRUCTURE;
  };

  /**
   * Keep asking while the page is young. `mine` is the lifecycle the attempt
   * belongs to: once a teardown, or a page that has announced itself, has moved
   * it on, this attempt is the previous page's business and stops.
   */
  const settle = (mine, deadline) => {
    if (mine !== life) return;
    if (run() || Date.now() >= deadline) return;
    setTimeout(settle, 250, mine, deadline);
  };

  /**
   * A page has finished being built. `yt-navigate-finish` is the one event that
   * says so on *both* a cold load and an in-page navigation, so this single
   * path covers arriving at a Watch Page either way.
   *
   * The page is not the one the last decision was made for, whatever happened
   * while it was being built, so the arrangement starts from nothing.
   */
  const start = () => {
    last = null;
    settle(++life, Date.now() + 10_000);
  };

  /**
   * A page that has just come back into view, which may still be the merest
   * shell: a hidden tab is not rendered, and YouTube builds far less of it while
   * nobody is looking — measured, a Watch Page opened in a background tab can
   * arrive at the moment it is shown having been built no further than the
   * skeleton. So this asks for longer than a page that announced itself does,
   * because what it is asking about is a page whose age we cannot see.
   */
  const resume = () => {
    last = null;
    settle(++life, 30_000);
  };

  /**
   * The previous page's arrangement, undone — driven by the event YouTube fires
   * as a navigation *starts*, measured about a second before the new page's
   * content lands.
   *
   * The ordering is the point, and it is enforced rather than hoped for: this
   * is synchronous, it runs on an event that precedes the page-ready one, and
   * it moves the lifecycle on so that no attempt left over from the page being
   * left can arrange anything into the page being built. By the time the new
   * content arrives there is nothing of ours in the document for it to be built
   * around, so the page is never half-arranged on the way through.
   *
   * The Comment Pane that follows is therefore a new one, which is also what
   * puts its scroll back at the top: the position it held was a place in the
   * previous video's thread.
   *
   * This event does not fire on a cold load, and there is nothing to undo there.
   */
  const teardown = () => {
    last = null;
    life++;
    adapter.revert();
  };

  // Read before the first decision, so the Pane is never briefly arranged at a
  // width the reader did not choose and then corrected — and, for the same
  // reason, so that a page loaded while the layout is off never shows an
  // arrangement it would only take back a frame later.
  const stored = store ? await store.get([PANE_WIDTH_KEY, ENABLED_KEY]).catch(() => null) : null;
  // Whether the stored value is usable is the engine's call, not ours.
  prefs.paneWidth = stored?.[PANE_WIDTH_KEY] ?? null;
  // Only an explicit `false` turns the layout off: a store that has never been
  // written, or that holds something else, leaves it on.
  prefs.enabled = stored?.[ENABLED_KEY] !== false;

  start();
  window.addEventListener('yt-navigate-finish', start);
  window.addEventListener('yt-navigate-start', teardown);

  // A window that narrows far enough for YouTube to collapse to one column has
  // to Step Aside — the Comment Pane lives in the rail YouTube is hiding, which
  // is exactly how the Comments silently disappear. The Adapter marks the
  // resizes it dispatches, so its own resync cannot re-enter here.
  window.addEventListener('resize', (event) => {
    if (!event.ysc) run();
  });
  // A resize is not enough on its own: YouTube answers one in its own time, and
  // fullscreen has no attribute at all. So the extension also listens to
  // YouTube changing its own mind, and to the document going fullscreen.
  document.addEventListener('fullscreenchange', () => run());
  // A tab that is not on screen is not rendered, and this category's most
  // repeated complaint is a video opened in a background tab that only gets its
  // Comment Pane after a refresh: YouTube answers for the page in its own time,
  // and a hidden tab is given less of it. A page coming back into view is one
  // that has to be arranged again, so it is treated as a page announcing
  // itself — by the time a reader is looking at it, the answer is knowable.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resume();
  });

  // The toolbar surface is the way back from the off switch, and it writes the
  // same preference. A page that only heard about it on its next reload would
  // leave the reader looking at the Native Layout they had just asked to leave
  // — which is the one-way door the toolbar surface exists to prevent — so the
  // change is followed, and followed at once.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !(ENABLED_KEY in changes)) return;
    prefs.enabled = changes[ENABLED_KEY].newValue !== false;
    run();
  });
})();
