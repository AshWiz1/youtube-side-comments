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

import { resolvePaneHeight } from './engine.js';

const ACTION_APPLY = 'apply';
const PANE_ID = 'ysc-pane';
const STRIP_ID = 'ysc-strip';

/**
 * The Comments are found by the `#comments` id, never by tag name. The bare
 * `ytd-comments` tag also matches a second, hidden element, so a tag match
 * silently picks the wrong one — and a tag match would find nothing at all the
 * day YouTube renames its element in an experiment. The id survives both.
 */
const COMMENTS = '#comments';

/**
 * The Recommendation Strip's content, found by the `#related` id — normally a
 * child of the right rail, alongside YouTube's panels, its playlist panel and
 * the Comment Pane, though YouTube moves the same element into the column below
 * the Player for its own layouts. Wherever it is, it is moved whole: the
 * related list is a live YouTube renderer that keeps loading its own
 * continuations, so it is never rebuilt, only relocated.
 */
const RELATED = '#related';

/**
 * YouTube's own box for the Player — the column the layout gives it, controls
 * and video surface together. Read to find out how much of the columns'
 * container is spent on something neither column gets, which is the only way to
 * know how wide the Pane can become before the Player falls under the width it
 * was measured safe at.
 */
const PLAYER = '#player';

/** YouTube's own mode flags, all carried by the watch root. */
const THEATER = 'theater';
const TWO_COLUMNS = 'is-two-columns_';
const SINGLE_COLUMN = 'is-single-column';

/**
 * YouTube's own marker, on the Comments region itself, that it has **not**
 * built its comment section there yet: the region is stamped as a hidden,
 * empty lazy-upgrade placeholder, and the stamp comes off in the same instant
 * YouTube fills the region — with its comment section, or with its own notice
 * that the video's comments are turned off. So the stamp, and not the empty
 * region, is what "the page is young" means: while it is on, the region is
 * evidence of nothing at all.
 */
const DISABLE_UPGRADE = 'disable-upgrade';

/**
 * The renderers YouTube builds for the Comments themselves: the header that
 * carries the count, the sort menu and the composer, and the threads below it.
 * A built region holding neither is YouTube's answer that there is nothing to
 * relocate — which is how a video whose comments are turned off arrives, with
 * the notice in the region and no comment section anywhere in it. Moving that
 * region would leave an empty Comment Pane holding a notice that belongs to
 * the page.
 */
const COMMENTS_SECTION = 'ytd-comments-header-renderer, ytd-comment-thread-renderer';

/** What YouTube has said about the Comments. These are the Layout Engine's
 *  `COMMENTS_STATE` identifiers, named here as `ACTION_APPLY` is named from
 *  `ACTION`: the Adapter produces them and the Engine compares them. */
const COMMENTS_STATE = { PENDING: 'pending', NONE: 'none', READY: 'ready' };

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
 * present; a frame inside it is not — and, measured, neither is it only ever a
 * live stream's. A past stream whose chat replay has never been opened carries
 * the frame too: empty, `collapsed`, `hide-chat-frame`, no box at all. Read as
 * "a live chat is here", that frame cost the Comment Pane for a chat nobody
 * could see, which is the fault `chatInUse` below exists to fix.
 */
const LIVE_CHAT = '#chat-container ytd-live-chat-frame';

/**
 * YouTube's own statement, on the watch root, that a live chat is **present and
 * expanded** — which is the question exactly: not whether a chat exists, but
 * whether one is in the rail and using it. YouTube rewrites it as the reader
 * collapses or expands the chat, so it is watched with the mode flags below and
 * the decision follows either way, without waiting for a navigation.
 */
const LIVE_CHAT_EXPANDED = 'live-chat-present-and-expanded';

/**
 * YouTube's own comments header — the row carrying the count and the sort
 * control — and the section of that row holding the controls beside the count.
 * The off control goes there rather than in a bar of ours, because a row that
 * already exists costs the layout no height, and because it is where a reader
 * already looks for the things that act on the Comments. That is the one place
 * this extension inserts anything *inside* a YouTube component, which is why it
 * is watched rather than written once: see `followOff`.
 */
const COMMENTS_HEADER = 'ytd-comments-header-renderer';
const HEADER_CONTROLS = '#additional-section';

const MODE_FLAGS = [THEATER, TWO_COLUMNS, SINGLE_COLUMN, LIVE_CHAT_EXPANDED, ...DOCKING_PANEL_MODES];
const WATCH_ROOT = MODE_FLAGS.map((flag) => `[${flag}]`).join(',');

/**
 * @param {Document} doc
 * @param {{splitter?: HTMLElement, toggle?: HTMLElement}} [deps]  The Splitter's
 *   element and the Pane's off control, which this Adapter places and takes back
 *   out, because it owns what goes into the page. Their behaviour belongs to
 *   their own modules.
 */
export function createAdapter(doc, { splitter, toggle } = {}) {
  /** Where the Comments came from, so they can be put back exactly. */
  let home = null;
  /** Where the related videos came from, for the same reason: the rail's order
   *  is YouTube's, and anything other than the exact position is a change we
   *  made to a page we then claimed to have left alone. */
  let relatedHome = null;
  /** The Comments region the observer is on, and the element holding it, so that
   *  the observer is re-pointed at a new one rather than duplicated or left
   *  behind. */
  let watchedComments = null;
  let watchedContainer = null;
  let commentsWatch = null;
  /** The width currently on the Pane, so the Splitter can start a gesture from
   *  what is actually on screen rather than from what it last asked for. */
  let appliedWidth = 0;
  /** The boxes the Pane's height is measured from, watched so that a page that
   *  moves under the Pane is answered with a new height. */
  let paneWatch = null;
  /** One Player resync per frame, however many widths a drag passes through. */
  let resyncQueued = false;
  /** The watch root the mode observer is on, so that it is re-pointed at a new
   *  one rather than duplicated or left behind. */
  let watchedRoot = null;
  let modeWatch = null;
  /** The Comments region the off control is being kept in, and the observer
   *  doing the keeping, for the same reason: YouTube replaces both the region
   *  and the header inside it, and the control has to follow them. */
  let watchedOff = null;
  let offWatch = null;

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
   *
   * The observer follows the root rather than staying on the element it first
   * saw: YouTube replaces its watch-page roots between videos, and an observer
   * left on a detached one hears nothing, which leaves the extension sitting on
   * a decision about a page that is gone.
   */
  function observeModes(onChange) {
    const root = watchRoot(locate());
    if (!root) return false;
    if (root !== watchedRoot) {
      modeWatch?.disconnect();
      watchedRoot = root;
      modeWatch = new MutationObserver(onChange);
      modeWatch.observe(root, { attributes: true, attributeFilter: MODE_FLAGS });
    }
    return true;
  }

  /**
   * Call back the moment YouTube answers for the Comments, whenever that is.
   *
   * This is watched rather than timed, for the reason the mode observer is:
   * YouTube writing the answer *is* the moment the decision can move, and no
   * clock can tell a page that has not been given the chance to answer from one
   * whose answer is "no comments". Measured: on a Watch Page in a background
   * tab, YouTube took 9.4s to build the comment section — three times what the
   * same page took in front of a reader, and longer than any window we would
   * have chosen. The region is observed rather than the watch root because the
   * answer is written on the region: the placeholder stamp coming off, and the
   * section — or YouTube's notice — arriving inside it.
   *
   * The observer follows the region for the same reason the mode observer
   * follows the root: YouTube replaces both between videos, and an observer
   * left on a detached element hears nothing. It is pointed at the region's
   * container as well, because YouTube replaces the region itself rather than
   * filling the one it left — which is only visible on the element that holds
   * it, and which would otherwise leave the extension on a decision about a
   * region that is gone.
   */
  function observeComments(onChange) {
    const comments = doc.querySelector(COMMENTS);
    const container = comments?.parentElement ?? null;
    if (comments === watchedComments && container === watchedContainer) return Boolean(comments);
    commentsWatch?.disconnect();
    watchedComments = comments;
    watchedContainer = container;
    commentsWatch = null;
    if (!comments) return false;
    commentsWatch = new MutationObserver(onChange);
    // One observer on both: the region's own markers, and the container's
    // children. The attribute filter names a marker only the region carries, so
    // watching the container for attributes costs nothing and can fire nothing.
    const watch = { attributes: true, attributeFilter: [DISABLE_UPGRADE], childList: true };
    commentsWatch.observe(comments, watch);
    if (container) commentsWatch.observe(container, watch);
    return true;
  }

  /**
   * Put the off control in YouTube's comments header, and keep it there.
   *
   * It goes beside the sort control, in the row that already carries the count —
   * so it takes no room the Pane was not already spending, and it sits with the
   * things that act on the Comments rather than in chrome of our own.
   *
   * What that costs is ownership: the header is YouTube's, and YouTube rebuilds
   * it — the count arrives, the sort menu is re-rendered, the whole header is
   * replaced outright — and a node inserted into it once is gone the first time
   * that happens, which would leave the layout with no way out of it but the
   * toolbar. So the region holding the header is watched, and the control is put
   * back whenever it goes or the header it was in goes with it.
   *
   * It is in the page exactly when the Comments are in the Pane — a page we have
   * Stepped Aside from carries nothing of ours, this included — which is read
   * from the Pane holding the region rather than from the decision, so the two
   * cannot disagree.
   */
  function followOff() {
    const comments = doc.getElementById(PANE_ID)?.querySelector(COMMENTS);
    if (!toggle || !comments) {
      toggle?.remove();
      return;
    }
    // Watched before it is placed, because the header arrives with YouTube's own
    // build, which can be later than the layout that waited for it.
    if (comments !== watchedOff) {
      offWatch?.disconnect();
      watchedOff = comments;
      offWatch = new MutationObserver(() => followOff());
      // The region and not the header alone: a header YouTube replaces arrives
      // as a child of the region, and this has to hear about that too.
      offWatch.observe(comments, { childList: true, subtree: true });
    }
    const header = comments.querySelector(COMMENTS_HEADER);
    // A region YouTube has not built its header into yet is a region with
    // nowhere to put this, and it is asked again by the observer above.
    if (!header) {
      toggle.remove();
      return;
    }
    const home = header.querySelector(HEADER_CONTROLS) ?? header.firstElementChild ?? header;
    if (toggle.parentElement !== home) home.append(toggle);
  }

  /**
   * Whether a live chat is in the rail and using it.
   *
   * Either of YouTube's own signals is enough, and either alone would have done
   * for every page measured — so both are read, because they fail in opposite
   * directions. The root's flag is the statement wanted and moves with the chat;
   * a frame with a real box is there for a page showing a chat without saying
   * so. The second is deliberately the conservative one — **anything with a box
   * counts** — so that a trigger which fails to fire can only fail towards the
   * Comment Pane, never towards a chat being displaced.
   *
   * Measured, 2026-09-12, on pages of both kinds, which is where the reading
   * comes from rather than from the shape of YouTube's markup:
   *
   * - Four live streams (`hlsnI3v2YX4`, `-LP3d7a71zQ`, `EMMkB01USUw`,
   *   `vfszY1JYbMc`): every one carries `live-chat-present-and-expanded` on the
   *   watch root, and has a frame at 515×809, `display: flex` — a chat in the
   *   rail, and the Comment Pane correctly given up for it.
   * - The page this was reported against (`jvczxxUUqNs`, a 22-minute upload):
   *   no flag, and a frame at 0×0, `display: none`, `collapsed`,
   *   `hide-chat-frame`, with `#chat-container` holding nothing. The Pane was
   *   given up anyway, and should not have been.
   */
  function chatInUse(root) {
    if (has(root, LIVE_CHAT_EXPANDED)) return true;
    const frame = doc.querySelector(LIVE_CHAT);
    return Boolean(frame && frame.getBoundingClientRect().height > 0);
  }

  /**
   * What YouTube has said about the Comments, read from the region itself.
   *
   * Every Watch Page renders the Comments region, and YouTube builds its
   * comment section into it only once the watch response has arrived — until
   * then the region carries YouTube's own placeholder, empty and hidden and
   * evidence of nothing. Measured on a Watch Page whose comments exist: the
   * region is a placeholder at 2.4s, upgraded — holding its header and the
   * threads' continuation — at 3.2s. A tab in the background builds the same
   * way and can be hidden for minutes, which is why a clock is the wrong
   * instrument for this question and not merely a badly tuned one: the state is
   * read from the page, so no window has to be tuned to anyone's connection,
   * and a hidden page is young for as long as it is hidden rather than until
   * some timer expires.
   */
  function commentsState(comments) {
    // A page nobody is looking at has not been given its chance to show its
    // Comments, whatever the region says: a hidden tab is not rendered, and no
    // conclusion about the video can be drawn from a page in that state. The
    // decision is re-taken when the tab is shown, which is the first moment it
    // can be judged — see the bootstrap's `resume`.
    if (doc.hidden) return COMMENTS_STATE.PENDING;
    if (!comments || comments.hasAttribute(DISABLE_UPGRADE)) return COMMENTS_STATE.PENDING;
    return comments.querySelector(COMMENTS_SECTION) ? COMMENTS_STATE.READY : COMMENTS_STATE.NONE;
  }

  /**
   * The box the Player and the Comment Pane share, which the width ceiling is a
   * fraction of. It has to be the columns' container and not the rail — the rail
   * *is* the Pane, so clamping against it would be circular. A page that cannot
   * say where the columns live falls back to the viewport, which is what this
   * box equals on every Watch Page measured.
   */
  function containerWidth(page = locate()) {
    return page?.primary.parentElement?.clientWidth || doc.documentElement.clientWidth;
  }

  /**
   * What that container spends on something that is neither column: the gutter
   * between the Player and the Pane, and the page's own margin around the two.
   *
   * Measured rather than assumed, because it is YouTube's chrome and a number of
   * ours would be wrong the day it lays the columns out differently. It is read
   * as a remainder — the container, less the Player's box, less the rail's
   * content, which is the Pane's own width once the layout is on — so every
   * inset is counted by one subtraction rather than named, and the reading is
   * the same before the layout is applied as after it: the padding that makes
   * it up is the page's own and we never touch it.
   *
   * A page that cannot say — no Player box to measure against, or a remainder
   * that came back as nothing — reports no chrome, which is the ceiling as it
   * stood before any of this was measured.
   */
  function columnChrome(page = locate()) {
    const player = doc.querySelector(PLAYER);
    if (!page || !player) return 0;
    const spent = containerWidth(page) - player.getBoundingClientRect().width - page.rail.clientWidth;
    return spent > 0 ? spent : 0;
  }

  function readState(prefs) {
    const page = locate();
    const root = watchRoot(page);
    // YouTube renders the Comments region on every Watch Page; this is the
    // region itself, whatever YouTube has decided to put in it.
    const comments = doc.querySelector(COMMENTS);
    return {
      viewport: {
        width: doc.documentElement.clientWidth,
        container: containerWidth(page),
        chrome: columnChrome(page),
      },
      page: {
        isWatchPage: doc.location.pathname === '/watch',
        isShorts: doc.location.pathname.startsWith('/shorts'),
        // Whether YouTube has built the Comments yet, and what it built there:
        // an empty region with no answer behind it is a young page, not a video
        // whose comments are turned off.
        commentsState: commentsState(comments),
        // Theater mode is persisted across loads, so it is read from the page
        // itself rather than from a toggle anyone has to have just performed.
        isTheater: has(root, THEATER),
        // Fullscreen has no reliable attribute; the document knows.
        isFullscreen: Boolean(doc.fullscreenElement),
        hasLiveChat: chatInUse(root),
        hasOpenPanel:
          Boolean(doc.querySelector(OPEN_PANEL)) ||
          DOCKING_PANEL_MODES.some((mode) => has(root, mode)),
        // Tri-state: true collapsed, false two columns, null when YouTube's
        // markers are absent — which is the only case where our own viewport
        // guard is allowed to speak.
        isSingleColumn: has(root, SINGLE_COLUMN) ? true : has(root, TWO_COLUMNS) ? false : null,
        // Only claim to understand the page if every element we reparent into
        // or out of is actually present. Whether the Comments region is there
        // to be relocated is a separate question, asked by `commentsState`
        // above: a page that has not built one yet is *young*, not
        // unrecognised, and the bootstrap retries that one reason rather than
        // Stepping Aside on it.
        structureRecognised: Boolean(page),
      },
      prefs,
    };
  }

  /**
   * Carry out a decision. Returns whether the page is now in the state the
   * decision describes — `false` only when there was nothing to arrange, which
   * is how the bootstrap can tell a page that is *young* from one that has been
   * arranged, and ask again rather than remember an arrangement it never made.
   */
  function apply(decision) {
    if (decision.action !== ACTION_APPLY) {
      // The single Step Aside path. Undoing an applied arrangement and saying
      // why are one act: "we never ran" and "we ran and undid it" have to be
      // the same page.
      revert();
      doc.documentElement.dataset.yscReason = decision.reason ?? '';
      return true;
    }

    const page = locate();
    const comments = doc.querySelector(COMMENTS);
    if (!page || !comments) return false;

    // Remember the original position before the first move — the Comments sit
    // behind an extra wrapper element inside `#below`, so the parent is
    // recorded rather than a region, and restoring to the wrong nesting depth
    // is a bug the prior art actually ships. Re-read whenever the Comments are
    // not already ours: reading it while they sit in the Pane would record the
    // Pane as their home.
    if (!doc.getElementById(PANE_ID)?.contains(comments)) {
      home = { parent: comments.parentNode, next: comments.nextSibling };
    }

    const pane = paneIn(page.rail);
    // The Splitter straddles the boundary between the Player and the Pane, so it
    // goes immediately before the Pane it resizes — and only when it is not
    // already there, because `insertBefore` is a move.
    if (splitter && splitter.nextElementSibling !== pane) page.rail.insertBefore(splitter, pane);
    // Appending the Comments is a *move* — a remove and an insert — even when
    // they are already the Pane's child. YouTube loads the Comments only while
    // their element is on screen, and a page arranged while its tab was hidden
    // is re-arranged the moment the tab is shown, exactly as that load begins,
    // so a move that changes nothing is a risk taken for nothing. A region
    // already in the Pane is therefore left exactly where it is.
    if (!pane.contains(comments)) pane.append(comments);

    // The Recommendation Strip moves as one element, contents and all, so the
    // related list keeps its own items, its own scroll and its own lazy-loading
    // sentinel. Re-read its home whenever it is not already ours, exactly as
    // the Comments' is — reading it while it sat in the Strip would record the
    // Strip as where it belongs.
    const related = doc.querySelector(RELATED);
    if (related) {
      const strip = stripIn(page);
      if (!strip.contains(related)) {
        relatedHome = { parent: related.parentNode, next: related.nextSibling };
        // The Strip holds the list YouTube is offering now and nothing else.
        // YouTube can *replace* the related element rather than refilling it —
        // it builds a fresh one for the next video — and the one we moved is
        // then a stale copy of the previous video's list, sitting in a
        // container nothing re-checks. It goes with the Strip rather than being
        // left beside the live one, where it would read as two lists.
        strip.replaceChildren(related);
      }
    }

    doc.documentElement.dataset.ysc = 'on';
    delete doc.documentElement.dataset.yscReason;
    // In the same frame the Pane appears in, so the way out is never a beat
    // behind the layout it is a way out of.
    followOff();
    setPaneWidth(decision.paneWidth);
    followPaneHeight();
    // Immediate rather than debounced: this is the one width change nobody is
    // dragging through, and a page that has just been arranged is the one moment
    // the Player has certainly not been resynced by YouTube itself.
    resyncPlayer();
    return true;
  }

  /**
   * A width change that did not come from a fresh decision — the Splitter's
   * drag, applied live so the Pane follows the pointer.
   */
  function setPaneWidth(width) {
    appliedWidth = width;
    // Stepped aside there is no Pane to widen, and leaving the property behind
    // would be a residue of a layout we are not running.
    if (doc.documentElement.dataset.ysc !== 'on') return;
    doc.documentElement.style.setProperty('--ysc-pane-width', `${width}px`);
    // Debounced to a frame: a drag passes through dozens of widths, and YouTube
    // answering each one with a full Player relayout is what makes a drag stutter.
    if (resyncQueued) return;
    resyncQueued = true;
    doc.defaultView.requestAnimationFrame(() => {
      resyncQueued = false;
      resyncPlayer();
    });
  }

  /**
   * How far the Pane's sticky top holds it from the window's top, read back
   * from the stylesheet rather than restated here, so that changing the CSS
   * cannot leave this measuring against an offset the Pane does not use. `auto`
   * — a Pane that is not sticky, before the layout is on — is no offset at all.
   */
  function stickyTop() {
    const pane = doc.getElementById(PANE_ID);
    const top = pane ? parseFloat(doc.defaultView.getComputedStyle(pane).top) : NaN;
    return Number.isFinite(top) ? top : 0;
  }

  /**
   * One measurement of the Pane's height, from the page as it stands.
   *
   * Both numbers are lengths on the page and both are read in the same frame.
   * The top of the columns is taken from the rail rather than from the Pane,
   * because the Pane is sticky: once it is stuck its own box reports where it
   * is pinned, and the height that reaches the Strip is measured from where the
   * Pane begins rather than from where it has been held.
   *
   * The Strip is the far end of the same measurement rather than an input to
   * it: a Strip that has not been laid out has no box, and a difference taken
   * from one would be a height of nothing.
   */
  function measurePaneHeight() {
    if (doc.documentElement.dataset.ysc !== 'on') return;
    const page = locate();
    const strip = doc.getElementById(STRIP_ID);
    if (!page || !strip) return;
    const columnsTop = page.rail.getBoundingClientRect().top;
    const stripTop = strip.getBoundingClientRect().top;
    const height = resolvePaneHeight({
      reach: stripTop > columnsTop ? stripTop - columnsTop : null,
      available: doc.documentElement.clientHeight - stickyTop(),
    });
    if (height !== null) {
      doc.documentElement.style.setProperty('--ysc-pane-height', `${height}px`);
    }
  }

  /**
   * Keep the Pane's height in step with the page it is drawn on.
   *
   * Watched rather than timed, because everything the height is made of moves
   * on YouTube's own account: the Player's column grows and shrinks with the
   * width the Splitter is dragging, the description expands when a reader asks
   * it to, and the Strip arrives with the related videos. The Player's own box
   * is not watched: it is inside its column, so a Player that moves has moved
   * the column with it.
   *
   * A window resize moves no column, so nothing watched resizes with it and the
   * viewport's own half of the rule has to be re-read by hand. The Adapter's own
   * resize — the one it dispatches to resync the Player — is not the window
   * changing, and is ignored for the same reason the bootstrap ignores it.
   */
  function followPaneHeight() {
    measurePaneHeight();
    const win = doc.defaultView;
    if (!win.ResizeObserver) return;
    if (!paneWatch) {
      paneWatch = new win.ResizeObserver(() => measurePaneHeight());
      win.addEventListener('resize', (event) => {
        if (!event.ysc) measurePaneHeight();
      });
    }
    const page = locate();
    const strip = doc.getElementById(STRIP_ID);
    if (page) paneWatch.observe(page.primary);
    if (strip) paneWatch.observe(strip);
  }

  /**
   * Undo an arrangement completely. Everything the extension put into the page
   * is removed and everything it moved goes back to the node it came from, so
   * that a page we stepped aside from is indistinguishable from one we never
   * touched. Leaving a page is the same act, and is served by this same path:
   * nothing about the page is remembered once its arrangement is gone.
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
    // Back to the node it came from, at the position it held there, which is
    // what makes a page we stepped aside from identical to one we never
    // arranged.
    const related = doc.querySelector(RELATED);
    if (relatedHome && related && relatedHome.parent.isConnected) {
      const before = relatedHome.next?.parentNode === relatedHome.parent ? relatedHome.next : null;
      relatedHome.parent.insertBefore(related, before);
    }
    doc.getElementById(STRIP_ID)?.remove();
    doc.getElementById(PANE_ID)?.remove();
    splitter?.remove();
    // The off control lives inside YouTube's comments header, so removing the
    // Pane does not take it with it: it is taken out here, explicitly, or a page
    // we stepped aside from would carry it in the header forever.
    toggle?.remove();
    offWatch?.disconnect();
    offWatch = null;
    watchedOff = null;
    paneWatch?.disconnect();
    paneWatch = null;
    doc.documentElement.style.removeProperty('--ysc-pane-width');
    doc.documentElement.style.removeProperty('--ysc-pane-height');
    delete doc.documentElement.dataset.ysc;
    delete doc.documentElement.dataset.yscReason;
    // A drag in flight when the layout went away has ended, whatever the pointer
    // is still doing: leaving this on the root would lock the page's cursor and
    // its text selection until the next gesture finished.
    delete doc.documentElement.dataset.yscDrag;
    home = null;
    relatedHome = null;
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

  return {
    readState,
    apply,
    revert,
    observeModes,
    observeComments,
    setPaneWidth,
    /** The width the Pane is actually at, which is what a gesture starts from. */
    paneWidth: () => appliedWidth,
    containerWidth,
    columnChrome,
  };
}

function has(element, attribute) {
  return element?.hasAttribute(attribute) ?? false;
}

/**
 * The Recommendation Strip — our full-width container below the columns, which
 * the related videos move into. Ours, and therefore disposable: the related
 * videos are YouTube's and go back to the rail.
 *
 * It is placed **after** the box holding the Player's column and the rail, so
 * it spans both rather than one of them, and inside the watch root, so it keeps
 * YouTube's own page margins.
 */
function stripIn(page) {
  let strip = page.primary.ownerDocument.getElementById(STRIP_ID);
  if (!strip) {
    strip = page.primary.ownerDocument.createElement('div');
    strip.id = STRIP_ID;
  }
  const columns = page.primary.parentElement;
  // `after` is a move, not a copy: re-running it on a Strip already in place
  // would be a reflow of the whole page for no change.
  if (strip.parentElement !== columns.parentElement || strip.previousElementSibling !== columns) {
    columns.after(strip);
  }
  return strip;
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
