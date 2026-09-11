/**
 * Layout Engine — the project's single testing seam.
 *
 * Pure: a plain description of the page goes in, a plain decision comes out.
 * No DOM, no browser, no storage, no side effects. Every product rule the
 * extension has lives here, which is what makes the rules enumerable in tests
 * instead of only observable in a browser.
 *
 * The vocabulary of reasons and placements is part of the interface: the popup
 * renders reasons, and the adapter obeys placements. They grow ticket by
 * ticket, so this list is deliberately not yet complete.
 */

/** What the extension should do. */
export const ACTION = {
  APPLY: 'apply',
  STEP_ASIDE: 'stepAside',
};

/**
 * Why the extension left the Native Layout alone. Stable identifiers, never
 * human-readable messages — presentation belongs to whatever displays them.
 */
export const REASON = {
  DISABLED: 'disabled',
  NOT_WATCH_PAGE: 'not-watch-page',
  UNRECOGNISED_STRUCTURE: 'unrecognised-structure',
  SHORTS: 'shorts',
  FULLSCREEN: 'fullscreen',
  THEATER: 'theater',
  LIVE_CHAT: 'live-chat',
  OPEN_PANEL: 'open-panel',
  COMMENTS_DISABLED: 'comments-disabled',
  SINGLE_COLUMN: 'single-column',
  TOO_NARROW: 'too-narrow',
};

/** Where each relocated region belongs. */
export const PLACE = {
  PANE: 'pane',
  STRIP: 'strip',
  NATIVE: 'native',
};

/** Matches the width of YouTube's own right rail, so the Comment Pane occupies
 *  exactly the space the Recommendation Strip vacated. */
export const DEFAULT_PANE_WIDTH = 402;

/** The narrowest the Comment Pane may become. Not arbitrary: this is
 *  `--ytd-watch-flexy-sidebar-min-width`, the minimum YouTube itself applies to
 *  that column. */
export const MIN_PANE_WIDTH = 320;

/** The narrowest Player we have measured. Widths below it were never measured,
 *  and the ceiling keeps the layout out of that band. */
export const MIN_PLAYER_WIDTH = 480;

/** The most of the container the Comment Pane may take. */
export const MAX_PANE_FRACTION = 0.6;

/**
 * The narrowest viewport our layout can serve: the Pane's floor (320px, the
 * minimum YouTube applies to that column) plus the narrowest Player we have
 * measured (480px). Used **only** when YouTube's own column signal is missing —
 * YouTube's signal is the authority on where two columns stop working, and it
 * collapses at a wider viewport than this.
 *
 * The same sum is the ceiling's second term, which is not a coincidence: where
 * the container is too small for both, the two clamps meet and the layout has
 * already Stepped Aside.
 */
export const MIN_TWO_COLUMN_VIEWPORT = MIN_PANE_WIDTH + MIN_PLAYER_WIDTH;

/**
 * Decide what to do with the page in front of us.
 *
 * The triggers are ordered: when several apply at once, the first one is the
 * reason reported. Identity comes first, then anything that obstructs the
 * Player, then anything of YouTube's we would displace, then whether there is
 * room for the layout at all, then whether there is anything to show.
 *
 * The order also decides what the retry in the bootstrap sees: only
 * `unrecognised-structure` means *early or changed*, so everything checked
 * before it has to be a genuine refusal in its own right — a fact about the
 * page, not a fact about how much of it has loaded yet.
 *
 * @param {object} state
 * @param {{width: number, container?: number}} state.viewport  `width` is the
 *   viewport; `container` is the box the Player and the Comment Pane share,
 *   which the width ceiling is a fraction of. A page that cannot say how wide
 *   that box is falls back to the viewport, which is what it usually equals.
 * @param {object} state.page               What the page actually is.
 * @param {object} state.prefs              The user's stored preferences.
 * @returns {{action: string, reason?: string, paneWidth?: number, placement?: object}}
 */
export function decide({ viewport, page, prefs }) {
  // The user's off switch outranks every other consideration: if they turned
  // the extension off, that is the reason worth reporting, whatever the page is.
  if (!prefs.enabled) return stepAside(REASON.DISABLED);
  if (page.isShorts) return stepAside(REASON.SHORTS);
  if (!page.isWatchPage) return stepAside(REASON.NOT_WATCH_PAGE);
  if (page.isFullscreen) return stepAside(REASON.FULLSCREEN);
  // Theater mode persists across loads, so it is a property of the page rather
  // than of the moment someone toggled it.
  if (page.isTheater) return stepAside(REASON.THEATER);
  if (page.hasLiveChat) return stepAside(REASON.LIVE_CHAT);
  if (page.hasOpenPanel) return stepAside(REASON.OPEN_PANEL);
  if (!page.structureRecognised) return stepAside(REASON.UNRECOGNISED_STRUCTURE);

  // YouTube collapses to a single column — and hides the rail the Comment Pane
  // lives in — at its own breakpoint. Applying our layout into a column YouTube
  // has already hidden is how the Comments silently disappear, so this reads
  // YouTube's own signal rather than a pixel threshold of our choosing. It
  // outranks the rest: in a column this narrow, nothing else about the page
  // changes the answer.
  if (page.isSingleColumn === true) return stepAside(REASON.SINGLE_COLUMN);
  if (page.commentsDisabled) return stepAside(REASON.COMMENTS_DISABLED);

  // Our own viewport guard is a fallback for a page where YouTube's signal is
  // absent, so that a silent change to it degrades to no room rather than to a
  // hidden Pane. It may never fire while YouTube still considers itself
  // two-column: where the two could disagree, YouTube wins.
  if (!columnSignalKnown(page) && viewport.width < MIN_TWO_COLUMN_VIEWPORT) {
    return stepAside(REASON.TOO_NARROW);
  }

  return {
    action: ACTION.APPLY,
    paneWidth: resolvePaneWidth(prefs.paneWidth, viewport.container ?? viewport.width),
    // The Comments go beside the Player and the Recommendation Strip goes below
    // the two of them, whichever they are: the placement is a fact about the
    // layout, so no page state — width, columns, rail occupancy — can move one
    // without the other.
    placement: { comments: PLACE.PANE, related: PLACE.STRIP },
  };
}

/**
 * The width the Comment Pane takes, from a request of any origin — a stored
 * preference, a drag, an arrow key. This is the **only** place a requested
 * width becomes a width, which is what makes it impossible for the pointer and
 * the keyboard to disagree about where the limits are.
 *
 * A request is a request, not an instruction: anything that isn't a usable
 * number falls back to the default rather than being trusted.
 *
 * @param {number} requested  The width asked for, in pixels.
 * @param {number} container  The width the Player and the Pane share.
 */
export function resolvePaneWidth(requested, container) {
  const wanted = usable(requested) ? requested : DEFAULT_PANE_WIDTH;
  return Math.min(Math.max(wanted, MIN_PANE_WIDTH), paneCeiling(container));
}

/**
 * The widest the Comment Pane may become: **the lesser of 60% of the container
 * and the container minus the narrowest measured Player**.
 *
 * The second term is the one that keeps the layout out of territory we never
 * measured — Player widths below 480px — and it binds for any container under
 * 1200px. The two terms cross at 800px, which is also the viewport our own
 * guard Steps Aside on.
 *
 * Where a container is small enough for the ceiling to fall under the floor the
 * **floor wins**, because the floor is the rail's own `min-width`: a Pane
 * narrower than it is not something the page would honour anyway. That leaves a
 * Player narrower than we have measured, on a page where YouTube still calls
 * itself two columns — which is a page we applied on before this clamp existed,
 * and applied on with less to spare.
 */
export function paneCeiling(container) {
  // No container to divide is no ceiling to apply; the floor and the default
  // still hold, since neither depends on the page.
  if (!usable(container)) return Infinity;
  return Math.max(
    MIN_PANE_WIDTH,
    Math.min(container * MAX_PANE_FRACTION, container - MIN_PLAYER_WIDTH),
  );
}

/** `isSingleColumn` is tri-state: true, false, or unknown (`null`) when the page
 *  carries neither of YouTube's column markers. */
function columnSignalKnown(page) {
  return page.isSingleColumn === true || page.isSingleColumn === false;
}

function stepAside(reason) {
  return { action: ACTION.STEP_ASIDE, reason };
}

function usable(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
