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
};

/** Where each relocated region belongs. */
export const PLACE = {
  PANE: 'pane',
  NATIVE: 'native',
};

/** Matches the width of YouTube's own right rail, so the Comment Pane occupies
 *  exactly the space the Recommendation Strip vacated. */
export const DEFAULT_PANE_WIDTH = 402;

/**
 * Decide what to do with the page in front of us.
 *
 * @param {object} state
 * @param {{width: number}} state.viewport  Viewport measurements.
 * @param {object} state.page               What the page actually is.
 * @param {object} state.prefs              The user's stored preferences.
 * @returns {{action: string, reason?: string, paneWidth?: number, placement?: object}}
 */
export function decide({ viewport, page, prefs }) {
  void viewport; // Needed by later tickets' rules; part of the agreed interface.

  // The user's off switch outranks every other consideration: if they turned
  // the extension off, that is the reason worth reporting, whatever the page is.
  if (!prefs.enabled) return stepAside(REASON.DISABLED);
  if (!page.isWatchPage) return stepAside(REASON.NOT_WATCH_PAGE);
  if (!page.structureRecognised) return stepAside(REASON.UNRECOGNISED_STRUCTURE);

  return {
    action: ACTION.APPLY,
    paneWidth: resolveWidth(prefs.paneWidth),
    placement: { comments: PLACE.PANE, related: PLACE.NATIVE },
  };
}

function stepAside(reason) {
  return { action: ACTION.STEP_ASIDE, reason };
}

/**
 * A stored width is a preference, not an instruction: anything that isn't a
 * usable number falls back to the default rather than being trusted.
 */
function resolveWidth(stored) {
  return typeof stored === 'number' && Number.isFinite(stored) && stored > 0
    ? stored
    : DEFAULT_PANE_WIDTH;
}
