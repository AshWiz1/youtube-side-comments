/**
 * DOM Adapter — the impure edge.
 *
 * Reads the page, hands a plain description to the Layout Engine, and applies
 * the decision. Everything that knows YouTube's markup lives here, so that a
 * YouTube change means rewriting this file and nothing else.
 */

const ACTION_APPLY = 'apply';
const PANE_ID = 'ysc-pane';

/**
 * YouTube has parallel watch-page roots in circulation. Matching on structure
 * inside any of them means an experiment elsewhere doesn't silently no-op us.
 */
const WATCH_ROOTS = 'ytd-watch-flexy, ytd-watch-grid, ytd-watch-learning-journey';

/** The Comments element carries this id; the bare tag matches a second, hidden
 *  element, and selecting on the tag alone picks the wrong one. */
const COMMENTS = 'ytd-comments#comments';

export function createAdapter(doc) {
  /** Where the Comments came from, so they can be put back exactly. */
  let home = null;

  const root = () => doc.querySelector(WATCH_ROOTS);

  function readState(prefs) {
    const watchRoot = root();
    const rail = watchRoot?.querySelector('#secondary-inner');
    return {
      viewport: { width: doc.documentElement.clientWidth },
      page: {
        isWatchPage: location.pathname === '/watch',
        // Only claim to understand the page if every element we reparent into
        // or out of is actually present.
        structureRecognised: Boolean(watchRoot && rail && doc.querySelector(COMMENTS)),
      },
      prefs,
    };
  }

  function apply(decision) {
    if (decision.action !== ACTION_APPLY) return;

    const watchRoot = root();
    const comments = doc.querySelector(COMMENTS);
    const rail = watchRoot?.querySelector('#secondary-inner');
    if (!comments || !rail) return;

    // Remember the original position once, before the first move. Restoring to
    // the wrong depth is a bug the prior art actually ships.
    home ??= { parent: comments.parentNode, next: comments.nextSibling };

    paneIn(rail).append(comments);
    doc.documentElement.style.setProperty('--ysc-pane-width', `${decision.paneWidth}px`);
    doc.documentElement.dataset.ysc = 'on';

    // YouTube sizes the player's internals on window resize and attaches no
    // observer to the player, so without this the video element overflows its
    // own frame after the column narrows.
    window.dispatchEvent(new Event('resize'));
  }

  function revert() {
    if (!home) return;
    home.parent.insertBefore(doc.querySelector(COMMENTS), home.next);
    doc.getElementById(PANE_ID)?.remove();
    delete doc.documentElement.dataset.ysc;
    home = null;
    window.dispatchEvent(new Event('resize'));
  }

  return { readState, apply, revert };
}

function paneIn(rail) {
  let pane = rail.querySelector(`#${PANE_ID}`);
  if (!pane) {
    pane = rail.ownerDocument.createElement('div');
    pane.id = PANE_ID;
    rail.prepend(pane);
  }
  return pane;
}
