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
 * The Comments are found by the `#comments` id, never by tag name. The bare
 * `ytd-comments` tag also matches a second, hidden element, so a tag match
 * silently picks the wrong one — and a tag match would find nothing at all the
 * day YouTube renames its element in an experiment. The id survives both.
 */
const COMMENTS = '#comments';

export function createAdapter(doc) {
  /** Where the Comments came from, so they can be put back exactly. */
  let home = null;

  /**
   * Locate the Watch Page by structure and identifiers rather than by
   * custom-element tag. YouTube has parallel watch-page roots in circulation
   * — `ytd-watch-flexy`, `ytd-watch-grid`, and more — all with structurally
   * identical internals, so matching on the familiar tag alone would silently
   * no-op for anyone in an experiment. The columns and the right rail are the
   * shape this extension actually depends on.
   */
  function locate() {
    const primary = doc.querySelector('#primary');
    const rail = doc.querySelector('#secondary-inner');
    return primary && rail ? { primary, rail } : null;
  }

  function readState(prefs) {
    const page = locate();
    return {
      viewport: { width: doc.documentElement.clientWidth },
      page: {
        isWatchPage: doc.location.pathname === '/watch',
        // Only claim to understand the page if every element we reparent into
        // or out of is actually present.
        structureRecognised: Boolean(page && doc.querySelector(COMMENTS)),
      },
      prefs,
    };
  }

  function apply(decision) {
    if (decision.action !== ACTION_APPLY) {
      // Stepping Aside is recorded rather than silent, so that "deliberately
      // off" stays distinguishable from "broken". Undoing an arrangement that
      // was already applied belongs to Step Aside itself; this only reports.
      doc.documentElement.dataset.yscReason = decision.reason ?? '';
      return;
    }

    const page = locate();
    const comments = doc.querySelector(COMMENTS);
    if (!page || !comments) return;

    // Remember the original position once, before the first move. The Comments
    // sit behind an extra wrapper element inside `#below`, so the parent is
    // recorded rather than a region — restoring to the wrong nesting depth is
    // a bug the prior art actually ships.
    home ??= { parent: comments.parentNode, next: comments.nextSibling };

    paneIn(page.rail).append(comments);
    doc.documentElement.style.setProperty('--ysc-pane-width', `${decision.paneWidth}px`);
    doc.documentElement.dataset.ysc = 'on';
    delete doc.documentElement.dataset.yscReason;

    // YouTube writes the Player's internal sizes on window resize and attaches
    // no observer to the Player, so without this the video element and the
    // control bar overflow their own frame by hundreds of pixels once the
    // column narrows. Measured: widening the Pane after the page has settled
    // leaves the <video> 498px wider than its frame, indefinitely, until one
    // synthetic resize lands. Load-bearing, not a workaround.
    doc.defaultView.dispatchEvent(new Event('resize'));
  }

  function revert() {
    const comments = doc.querySelector(COMMENTS);
    if (home && comments) {
      // A remembered sibling may itself have been removed by YouTube since;
      // appending is the safe fallback and cannot throw.
      const before = home.next?.parentNode === home.parent ? home.next : null;
      home.parent.insertBefore(comments, before);
    }
    doc.getElementById(PANE_ID)?.remove();
    doc.documentElement.style.removeProperty('--ysc-pane-width');
    delete doc.documentElement.dataset.ysc;
    delete doc.documentElement.dataset.yscReason;
    home = null;
    doc.defaultView.dispatchEvent(new Event('resize'));
  }

  return { readState, apply, revert };
}

function paneIn(rail) {
  let pane = rail.querySelector(`#${PANE_ID}`);
  if (!pane) {
    pane = rail.ownerDocument.createElement('div');
    pane.id = PANE_ID;
    // Prepended, so that YouTube's own panels, its playlist panel and its
    // Recommendation Strip stay in the rail alongside us rather than being
    // displaced by us — transcripts and playlists must keep working.
    rail.prepend(pane);
  }
  return pane;
}
