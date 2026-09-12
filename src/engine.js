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

/**
 * What the toolbar surface is looking at, from what the page records about
 * itself. The surface's whole job is to be the way back from the off switch, so
 * what it says is a decision, and it belongs here rather than in the popup's own
 * conditionals.
 */
export const SURFACE = {
  /** The Comment Pane is on the page. */
  APPLIED: 'applied',
  /** The user's own off switch is what is keeping the layout off. */
  OFF: 'off',
  /** The layout is on, and the page was refused anyway, for the reason below. */
  STEPPED_ASIDE: 'stepped-aside',
  /** Nothing of ours has spoken for this page, so there is nothing to report. */
  ELSEWHERE: 'elsewhere',
};

/**
 * What YouTube has said about the Comments on the page in front of us.
 *
 * YouTube renders the Comments region on **every** Watch Page and builds its
 * comment section into it only once its watch response has arrived, so the
 * region's presence says nothing, and an empty region is the *young* state
 * rather than an answer about the video. These are read from YouTube's own
 * markers — the placeholder it leaves before it builds, and the section it
 * builds afterwards — never from how long the region has been empty: a hidden
 * tab is given minutes and still has no answer in it, and a slow connection is
 * not a commentless video.
 */
export const COMMENTS_STATE = {
  /** YouTube has not built it yet: nothing can be concluded from the region. */
  PENDING: 'pending',
  /** YouTube built it and there is nothing in it to relocate. */
  NONE: 'none',
  /** YouTube built its comment section: there are Comments to relocate. */
  READY: 'ready',
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
 * The same sum, plus whatever the container spends around the columns, is the
 * ceiling's second term, which is not a coincidence: where the container is too
 * small for both, the two clamps meet and the layout has already Stepped Aside.
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
 * page, not a fact about how much of it has loaded yet. A page YouTube has not
 * built its Comments on retries through that same reason, deliberately: there
 * is nothing to conclude from it, and no clock that would make a conclusion
 * honest.
 *
 * @param {object} state
 * @param {{width: number, container?: number, chrome?: number}} state.viewport
 *   `width` is the viewport; `container` is the box the Player and the Comment
 *   Pane share, which the width ceiling is a fraction of; `chrome` is what that
 *   box spends on neither of them. A page that cannot say how wide the box is
 *   falls back to the viewport, which is what it usually equals, and one that
 *   cannot say what the box spends leaves the ceiling where it was.
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
  // YouTube has not built its comment section yet. Every Watch Page renders the
  // Comments region and leaves it empty while the watch response is on its way,
  // so an empty region is the page being young and not an answer about the
  // video: nothing is concluded from it, and the page is asked again instead of
  // being Stepped Aside from. This outranks our own viewport guard below,
  // because a page YouTube has not built cannot yet say whether it is one
  // column or two, and the guard is a fallback for a page that can.
  if (page.commentsState === COMMENTS_STATE.PENDING) {
    return stepAside(REASON.UNRECOGNISED_STRUCTURE);
  }
  // YouTube built its comment section and there is nothing in it to relocate:
  // the video's comments are turned off. Relocating that region would leave an
  // empty Comment Pane behind, and moving YouTube's own notice into the Pane is
  // worse than leaving the whole page alone.
  if (page.commentsState === COMMENTS_STATE.NONE) return stepAside(REASON.COMMENTS_DISABLED);

  // Our own viewport guard is a fallback for a page where YouTube's signal is
  // absent, so that a silent change to it degrades to no room rather than to a
  // hidden Pane. It may never fire while YouTube still considers itself
  // two-column: where the two could disagree, YouTube wins.
  if (!columnSignalKnown(page) && viewport.width < MIN_TWO_COLUMN_VIEWPORT) {
    return stepAside(REASON.TOO_NARROW);
  }

  return {
    action: ACTION.APPLY,
    paneWidth: resolvePaneWidth(
      prefs.paneWidth,
      viewport.container ?? viewport.width,
      viewport.chrome,
    ),
    // The Comments go beside the Player and the Recommendation Strip goes below
    // the two of them, whichever they are: the placement is a fact about the
    // layout, so no page state — width, columns, rail occupancy — can move one
    // without the other.
    placement: { comments: PLACE.PANE, related: PLACE.STRIP },
  };
}

/**
 * What the toolbar surface says about the page behind it.
 *
 * This is the **only** way the surface learns anything, and it is fed from what
 * the page records — `data-ysc` for an applied layout and `data-ysc-reason` for
 * the engine's most recent decision — so the reason it reports is the one the
 * engine actually recorded, an automatic Step Aside the user never triggered
 * included. A page carrying an identifier this engine does not know — an older
 * version's, or another extension's — reports nothing rather than something
 * wrong, which is what "never reports a reason the engine did not record" costs
 * in code: one membership test.
 *
 * The off switch is the one thing the surface can undo, because it is the one
 * thing the in-page control can do. Everything else the engine refuses — theater
 * mode, a single column, comments turned off — is a fact about the page, and
 * offering to turn the layout "on" over it would be offering nothing.
 *
 * @param {object} state
 * @param {boolean} state.enabled   The stored preference.
 * @param {boolean} state.applied   Whether the page carries an arrangement.
 * @param {string|null} state.reason  What the page recorded, if anything.
 * @returns {{state: string, reason: string|null, canEnable: boolean}}
 */
export function surfaceFor({ enabled = true, applied = false, reason = null } = {}) {
  // An arrangement on the page is the one thing that outranks the preference
  // here as it does in `decide`: whatever the store says, the Pane is what the
  // reader is looking at.
  if (applied) return { state: SURFACE.APPLIED, reason: null, canEnable: false };
  const recorded = isReason(reason) ? reason : null;
  if (!enabled || recorded === REASON.DISABLED) {
    // Reported as the engine's own identifier rather than as the preference:
    // the surface says what was decided, not what was stored.
    return { state: SURFACE.OFF, reason: REASON.DISABLED, canEnable: true };
  }
  if (recorded) return { state: SURFACE.STEPPED_ASIDE, reason: recorded, canEnable: false };
  return { state: SURFACE.ELSEWHERE, reason: null, canEnable: false };
}

/**
 * Whether a decision asks for anything the page does not already have, given
 * the decision the arrangement standing on it was made from.
 *
 * `last` is `null` when there is no arrangement of ours to leave alone — the
 * page has just been built, or the previous page's arrangement has been torn
 * down — and a page like that is arranged whatever the decision says, because
 * the decision is a fact about the page and not about the page it was decided
 * for. That is the whole of what navigation adds here, and it is what makes a
 * decision that merely *equals* the last one land on a page that was rebuilt
 * under it.
 *
 * The comparison is worth making at all because deciding is cheap and arranging
 * is not: moving the Comments drops the reader's place in the thread, so the
 * page is only arranged when the decision has actually moved. The width is part
 * of it, and has to be — a width change is the one decision the page makes
 * without any of the others changing, so a comparison that looked only at the
 * action would leave the Comment Pane at a width the engine no longer agrees
 * with after a restart, or after anything else moved the ceiling.
 *
 * @param {object|null} last      The decision the arrangement was made from.
 * @param {object} decision       The decision for the page in front of us.
 */
export function needsArranging(last, decision) {
  if (!last) return true;
  return (
    decision.action !== last.action ||
    decision.reason !== last.reason ||
    decision.paneWidth !== last.paneWidth
  );
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
 * @param {number} [chrome]   What that width spends on neither of them, which
 *   the ceiling leaves to them before it divides the rest.
 */
export function resolvePaneWidth(requested, container, chrome = 0) {
  const wanted = usable(requested) ? requested : DEFAULT_PANE_WIDTH;
  return Math.min(Math.max(wanted, MIN_PANE_WIDTH), paneCeiling(container, chrome));
}

/**
 * The widest the Comment Pane may become: **the lesser of 60% of the container
 * and the container minus the chrome around the columns minus the narrowest
 * measured Player**.
 *
 * The second term is the one that keeps the layout out of territory we never
 * measured — Player widths below 480px — and it binds for any container under
 * 1200px, or under 1320px once the chrome is counted. Where the container is
 * small enough that both terms fall under the floor, the two clamps meet at
 * `MIN_TWO_COLUMN_VIEWPORT` of container plus the chrome — which is the viewport
 * our own guard Steps Aside on, near enough that the two land together.
 *
 * `chrome` is what the container spends on something that is neither column:
 * the gutter between them and the page's own margin around them. It has to come
 * off before the Player's share is worked out, or the term promises the Player
 * a width the page then takes the chrome out of — measured on a live Watch
 * Page, the Player's column ends up 48px narrower than this term intended,
 * which is what put its ceiling inside the band we never measured.
 *
 * Where a container is small enough for the ceiling to fall under the floor the
 * **floor wins**, because the floor is the rail's own `min-width`: a Pane
 * narrower than it is not something the page would honour anyway. That leaves a
 * Player narrower than we have measured, on a page where YouTube still calls
 * itself two columns — which is a page we applied on before this clamp existed,
 * and applied on with less to spare.
 *
 * @param {number} container  The box the Player and the Comment Pane share.
 * @param {number} [chrome]   What that box spends on neither of them. A page
 *   that cannot measure it constrains the ceiling as the page itself does not.
 */
export function paneCeiling(container, chrome = 0) {
  // No container to divide is no ceiling to apply; the floor and the default
  // still hold, since neither depends on the page.
  if (!usable(container)) return Infinity;
  const spent = usable(chrome) ? chrome : 0;
  return Math.max(
    MIN_PANE_WIDTH,
    Math.min(container * MAX_PANE_FRACTION, container - spent - MIN_PLAYER_WIDTH),
  );
}

/**
 * How tall the Comment Pane may be: as tall as it takes to reach the
 * Recommendation Strip, and no taller than the viewport allows.
 *
 * The two cannot both hold on a page whose description is longer than the
 * window, and the viewport is the one that wins. The Pane is sticky so the
 * Comments stay readable while the page scrolls, which puts its top at the
 * masthead and its bottom on the fold; a Pane taller than that runs the end of
 * the thread — and the Pane's own bottom edge, which is the only thing saying
 * where the Comments stop — off the bottom of the window, which is the whole
 * reason the Pane sticks at all. So a page whose description fits gets a Pane
 * that ends on the Strip, with no dead space beside the description, and a page
 * whose description does not gets exactly as much of one as there is room for.
 *
 * A measurement that is missing — no Strip on the page yet, a viewport that
 * cannot say how tall it is — constrains nothing. Both missing is nothing to
 * say, which is `null`: the stylesheet's own default stands rather than a
 * height invented here.
 *
 * @param {number} reach      The height at which the Pane ends on the Strip.
 * @param {number} available  The viewport below the Pane's sticky top.
 * @returns {number|null} The Pane's height in pixels.
 */
export function resolvePaneHeight({ reach, available }) {
  const measured = [reach, available].filter(usable);
  return measured.length ? Math.round(Math.min(...measured)) : null;
}

/** `isSingleColumn` is tri-state: true, false, or unknown (`null`) when the page
 *  carries neither of YouTube's column markers. */
function columnSignalKnown(page) {
  return page.isSingleColumn === true || page.isSingleColumn === false;
}

/** Whether a string is one of the engine's own reason identifiers. */
function isReason(value) {
  return typeof value === 'string' && Object.values(REASON).includes(value);
}

function stepAside(reason) {
  return { action: ACTION.STEP_ASIDE, reason };
}

function usable(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
