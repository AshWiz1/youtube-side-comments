/**
 * DOM Adapter — the impure edge.
 *
 * Reads the page, hands a plain description to the Layout Engine, and applies
 * the decision. Everything that knows YouTube's markup lives here, so that a
 * YouTube change means rewriting this file and nothing else.
 *
 * Stepping Aside is served by **one** code path: every trigger — the manual off
 * switch, every mode exclusion, every automatic failure — arrives as a decision
 * from the engine and lands in the same branch, which undoes whatever was
 * applied and records why. Nothing here decides; it only reads and obeys.
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

/** YouTube's own mode flags, all carried by the watch root. */
const THEATER = 'theater';
const TWO_COLUMNS = 'is-two-columns_';
const SINGLE_COLUMN = 'is-single-column';

/**
 * YouTube's own record of whether the watch response it rendered carried a
 * comment section, set on the watch root. YouTube renders the Comments region
 * on every Watch Page — so the region's presence cannot tell us whether there
 * is anything to put in it — but this flag does: a video with comments turned
 * off arrives without it, and relocating the region then leaves an empty
 * Comment Pane. Measured against YouTube's own watch responses for 420 videos:
 * the flag tracks the response's comment section exactly, including the live
 * streams where the region renders empty because chat has replaced it.
 */
const RESPONSE_HAS_COMMENTS = 'response-has-comments';

/**
 * How long a commentless Comments region is allowed to stay that way before it
 * counts as YouTube's answer rather than as a page still being built.
 *
 * Measured on a Watch Page whose comments do exist: the region appears empty at
 * 2.5s and YouTube fills it — and sets `response-has-comments` — at 3.6s, the
 * two arriving together with the watch response. Before that, a video with
 * comments and a video with none are *identical* in the page, so an empty
 * region is evidence of nothing and acting on it would leave the extension
 * permanently stepped aside on ordinary videos. This window is observation
 * latency, not a product threshold: the largest measured delay is 1.1s.
 */
const COMMENTS_SETTLE_MS = 3000;

/**
 * Panel modes that dock **horizontally**, at the rail's own width, and so
 * genuinely compete with the Comment Pane for the same column. YouTube ships
 * them dormant behind flags; an ordinary expanded panel stacks vertically and
 * is harmless, but any of these is a collision waiting to happen.
 */
const DOCKING_PANEL_MODES = [
  'fixed-panels',
  'panels-beside-player',
  'squeezeback',
  'transcript-opened_',
  'split-scroll',
];

/** An expanded panel occupying YouTube's own panel stack. */
const OPEN_PANEL = '#panels [visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]';

/**
 * Live chat lives at `#chat-container` inside the rail. The container is always
 * present; only the frame materialises, and only on a live stream or premiere.
 */
const LIVE_CHAT = '#chat-container ytd-live-chat-frame';

const MODE_FLAGS = [THEATER, TWO_COLUMNS, SINGLE_COLUMN, ...DOCKING_PANEL_MODES];
const WATCH_ROOT = MODE_FLAGS.map((flag) => `[${flag}]`).join(',');

export function createAdapter(doc) {
  /** Where the Comments came from, so they can be put back exactly. */
  let home = null;
  /** When the Comments region was first seen with nothing in it. */
  let blankSince = 0;

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

  /**
   * YouTube's watch root, found structurally: the nearest ancestor of the
   * Player's column carrying YouTube's own mode flags. No tag name is matched,
   * so an experimental root still resolves.
   */
  function watchRoot(page) {
    return page?.primary.closest(WATCH_ROOT) ?? doc.querySelector(WATCH_ROOT);
  }

  /**
   * Call back whenever YouTube changes one of its own mode flags on the watch
   * root — theater mode, the column signal, a horizontally-docking panel mode.
   *
   * This is watched rather than timed. Measured: YouTube re-lays the columns out
   * *after* the window resize event, so a window narrowed to one column still
   * reads as two columns at the moment it changes, and a window widened back
   * still reads as one — the extension would step aside on the way out and stay
   * aside on the way back. YouTube writing the flag is the moment the answer
   * actually changes, whenever that is.
   */
  function observeModes(onChange) {
    const root = watchRoot(locate());
    if (!root) return false;
    new MutationObserver(onChange).observe(root, {
      attributes: true,
      attributeFilter: MODE_FLAGS,
    });
    return true;
  }

  /**
   * Whether YouTube has finished saying what belongs in the Comments region:
   * either it has put something there, or it has left the region empty long
   * enough that a response carrying comments would have arrived. Until then the
   * page is young, and the honest answer is that we do not know yet.
   */
  function commentsSettled(root) {
    const comments = doc.querySelector(COMMENTS);
    if (!comments) return false;
    if (comments.firstElementChild || has(root, RESPONSE_HAS_COMMENTS)) {
      blankSince = 0;
      return true;
    }
    blankSince ||= Date.now();
    return Date.now() - blankSince >= COMMENTS_SETTLE_MS;
  }

  function readState(prefs) {
    const page = locate();
    const root = watchRoot(page);
    // YouTube renders the Comments region on every Watch Page; this is the
    // region itself, whatever YouTube has decided to put in it.
    const comments = doc.querySelector(COMMENTS);
    return {
      viewport: { width: doc.documentElement.clientWidth },
      page: {
        isWatchPage: doc.location.pathname === '/watch',
        isShorts: doc.location.pathname.startsWith('/shorts'),
        // Theater mode is persisted across loads, so it is read from the page
        // itself rather than from a toggle anyone has to have just performed.
        isTheater: has(root, THEATER),
        // Fullscreen has no reliable attribute; the document knows.
        isFullscreen: Boolean(doc.fullscreenElement),
        hasLiveChat: Boolean(doc.querySelector(LIVE_CHAT)),
        hasOpenPanel:
          Boolean(doc.querySelector(OPEN_PANEL)) ||
          DOCKING_PANEL_MODES.some((mode) => has(root, mode)),
        // Nothing for the Comment Pane to show: YouTube rendered a Comments
        // region and put nothing in it, and its watch response carried no
        // comment section. Relocating that region would leave an empty Pane.
        commentsDisabled:
          Boolean(comments) && !comments.firstElementChild && !has(root, RESPONSE_HAS_COMMENTS),
        // Tri-state: true collapsed, false two columns, null when YouTube's
        // markers are absent — which is the only case where our own viewport
        // guard is allowed to speak.
        isSingleColumn: has(root, SINGLE_COLUMN) ? true : has(root, TWO_COLUMNS) ? false : null,
        // Only claim to understand the page if every element we reparent into
        // or out of is actually present, and if YouTube has finished saying
        // what belongs in its Comments region — a page that has not yet built
        // or answered for one is *young*, not unrecognised, and the bootstrap
        // retries this one reason rather than Stepping Aside on it.
        structureRecognised: Boolean(page && commentsSettled(root)),
      },
      prefs,
    };
  }

  function apply(decision) {
    if (decision.action !== ACTION_APPLY) {
      // The single Step Aside path. Undoing an applied arrangement and saying
      // why are one act: "we never ran" and "we ran and undid it" have to be
      // the same page.
      revert();
      doc.documentElement.dataset.yscReason = decision.reason ?? '';
      return;
    }

    const page = locate();
    const comments = doc.querySelector(COMMENTS);
    if (!page || !comments) return;

    // Remember the original position before the first move — the Comments sit
    // behind an extra wrapper element inside `#below`, so the parent is
    // recorded rather than a region, and restoring to the wrong nesting depth
    // is a bug the prior art actually ships. Re-read whenever the Comments are
    // not already ours: reading it while they sit in the Pane would record the
    // Pane as their home.
    if (!doc.getElementById(PANE_ID)?.contains(comments)) {
      home = { parent: comments.parentNode, next: comments.nextSibling };
    }

    paneIn(page.rail).append(comments);
    doc.documentElement.style.setProperty('--ysc-pane-width', `${decision.paneWidth}px`);
    doc.documentElement.dataset.ysc = 'on';
    delete doc.documentElement.dataset.yscReason;
    resyncPlayer();
  }

  /**
   * Undo an arrangement completely. Everything the extension put into the page
   * is removed and everything it moved goes back to the node it came from, so
   * that a page we stepped aside from is indistinguishable from one we never
   * touched.
   */
  function revert() {
    const comments = doc.querySelector(COMMENTS);
    // A remembered parent may have been removed by YouTube since — a page we
    // never arranged, or one whose Comments are already gone. Appending is the
    // safe fallback and cannot throw.
    if (home && comments && home.parent.isConnected) {
      const before = home.next?.parentNode === home.parent ? home.next : null;
      home.parent.insertBefore(comments, before);
    }
    doc.getElementById(PANE_ID)?.remove();
    doc.documentElement.style.removeProperty('--ysc-pane-width');
    delete doc.documentElement.dataset.ysc;
    delete doc.documentElement.dataset.yscReason;
    home = null;
    resyncPlayer();
  }

  /**
   * YouTube writes the Player's internal sizes on window resize and attaches no
   * observer to the Player, so without this the video element and the control
   * bar overflow their own frame by hundreds of pixels once the column changes
   * width. Measured: widening the Pane after the page has settled leaves the
   * <video> 498px wider than its frame, indefinitely, until one synthetic
   * resize lands. Load-bearing, not a workaround — and marked as ours, so the
   * bootstrap cannot mistake it for the window actually changing size.
   */
  function resyncPlayer() {
    const event = new Event('resize');
    event.ysc = true;
    doc.defaultView.dispatchEvent(event);
  }

  return { readState, apply, revert, observeModes };
}

function has(element, attribute) {
  return element?.hasAttribute(attribute) ?? false;
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
