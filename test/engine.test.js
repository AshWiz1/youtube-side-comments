import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decide,
  needsArranging,
  resolvePaneWidth,
  resolvePaneHeight,
  paneCeiling,
  surfaceFor,
  ACTION,
  REASON,
  PLACE,
  SURFACE,
  COMMENTS_STATE,
  DEFAULT_PANE_WIDTH,
  MIN_PANE_WIDTH,
  MIN_PLAYER_WIDTH,
  MIN_TWO_COLUMN_VIEWPORT,
} from '../src/engine.js';
// What the two surfaces say, held against the engine's own vocabulary below.
import { STATUS, WHY, ELSEWHERE_HINT } from '../src/words.js';

/** An ordinary desktop Watch Page: two columns by YouTube's own signal, and its
 *  comment section built and holding Comments. */
const state = ({ viewport = {}, page = {}, prefs = {} } = {}) => ({
  viewport: { width: 1920, ...viewport },
  page: {
    isWatchPage: true,
    structureRecognised: true,
    isSingleColumn: false,
    commentsState: COMMENTS_STATE.READY,
    ...page,
  },
  prefs: { enabled: true, paneWidth: null, ...prefs },
});

/** Every trigger, one per row. */
const triggers = [
  ['off switch', { prefs: { enabled: false } }, REASON.DISABLED],
  ['Shorts', { page: { isShorts: true } }, REASON.SHORTS],
  ['not a Watch Page', { page: { isWatchPage: false } }, REASON.NOT_WATCH_PAGE],
  ['fullscreen', { page: { isFullscreen: true } }, REASON.FULLSCREEN],
  ['theater mode', { page: { isTheater: true } }, REASON.THEATER],
  ['a live chat', { page: { hasLiveChat: true } }, REASON.LIVE_CHAT],
  ['an open YouTube panel', { page: { hasOpenPanel: true } }, REASON.OPEN_PANEL],
  ['unknown structure', { page: { structureRecognised: false } }, REASON.UNRECOGNISED_STRUCTURE],
  ["YouTube's Comments not built yet", { page: { commentsState: COMMENTS_STATE.PENDING } }, REASON.UNRECOGNISED_STRUCTURE],
  ['no Comments to relocate', { page: { commentsState: COMMENTS_STATE.NONE } }, REASON.COMMENTS_DISABLED],
  ["YouTube's own single column", { page: { isSingleColumn: true } }, REASON.SINGLE_COLUMN],
  ["a viewport too narrow, YouTube's signal absent", { page: { isSingleColumn: null }, viewport: { width: 700 } }, REASON.TOO_NARROW],
  ['a viewport one pixel under the fallback', { page: { isSingleColumn: null }, viewport: { width: 799 } }, REASON.TOO_NARROW],
];
for (const [name, s, reason] of triggers) {
  test(`steps aside: ${name}`, () => {
    assert.deepEqual(decide(state(s)), { action: ACTION.STEP_ASIDE, reason });
  });
}

// [name, state, the width the Pane takes]. A narrow page still applies — its
// signal says two columns — and takes the floor rather than the default,
// because the Player cannot spare the difference.
const applies = [
  ['an ordinary Watch Page', {}, DEFAULT_PANE_WIDTH],
  ['a viewport 400px narrower than YouTube needs', { viewport: { width: 700 } }, MIN_PANE_WIDTH],
  ['the fallback threshold exactly', { page: { isSingleColumn: null }, viewport: { width: MIN_TWO_COLUMN_VIEWPORT } }, MIN_PANE_WIDTH],
  ["YouTube's signal absent but room to spare", { page: { isSingleColumn: null } }, DEFAULT_PANE_WIDTH],
];
for (const [name, s, paneWidth] of applies) {
  test(`applies: ${name}`, () => {
    assert.deepEqual(decide(state(s)), {
      action: ACTION.APPLY,
      paneWidth,
      // The Comments beside the Player and the Recommendation Strip below the
      // two of them, on every page we apply to.
      placement: { comments: PLACE.PANE, related: PLACE.STRIP },
    });
  });
}

// A Step Aside moves nothing, so it promises nothing: a placement belongs to an
// apply alone, and every trigger is held to that.
test('a Step Aside carries no placement', () => {
  for (const [name, s] of triggers) {
    assert.equal(decide(state(s)).placement, undefined, name);
  }
});

// The Adapter obeys these strings, so renaming one moves the wrong thing.
test('place identifiers are stable', () => {
  assert.deepEqual(PLACE, { PANE: 'pane', STRIP: 'strip', NATIVE: 'native' });
});

// The Adapter reads these from YouTube's own markers and the Engine compares
// them, so a rename on either side would stop them meeting.
test('comments state identifiers are stable', () => {
  assert.deepEqual(COMMENTS_STATE, { PENDING: 'pending', NONE: 'none', READY: 'ready' });
});

// The spec's rule for overlaps: the reason reported is the first trigger that
// matches, and the order is the engine's to choose — so pin it down.
const firsts = [
  ['the off switch outranks everything', { prefs: { enabled: false }, page: { isShorts: true, isTheater: true } }, REASON.DISABLED],
  ['Shorts outranks another page', { page: { isShorts: true, isWatchPage: false } }, REASON.SHORTS],
  ['fullscreen outranks theater', { page: { isFullscreen: true, isTheater: true } }, REASON.FULLSCREEN],
  ['a live chat outranks an open panel', { page: { hasLiveChat: true, hasOpenPanel: true } }, REASON.LIVE_CHAT],
  ['a mode outranks the structure', { page: { isTheater: true, structureRecognised: false } }, REASON.THEATER],
  ['structure outranks no comments', { page: { structureRecognised: false, commentsState: COMMENTS_STATE.NONE } }, REASON.UNRECOGNISED_STRUCTURE],
  ['no room outranks no comments', { page: { commentsState: COMMENTS_STATE.NONE, isSingleColumn: true } }, REASON.SINGLE_COLUMN],
  // A page YouTube has not built is asked again rather than judged by our own
  // guard: it cannot say which column state it is in yet, and the guard is a
  // fallback for a page that can.
  ['a young page outranks our viewport guard', { page: { commentsState: COMMENTS_STATE.PENDING, isSingleColumn: null }, viewport: { width: 700 } }, REASON.UNRECOGNISED_STRUCTURE],
  ["YouTube's column outranks our viewport", { page: { isSingleColumn: true }, viewport: { width: 400 } }, REASON.SINGLE_COLUMN],
];
for (const [name, s, reason] of firsts) {
  test(`first trigger wins: ${name}`, () => {
    assert.equal(decide(state(s)).reason, reason);
  });
}

// The off switch is outranked by nothing, and the table above is the whole list
// of things it has to outrank — so each trigger is asked again with the switch
// off rather than a second list being written down and drifting.
test('the off switch outranks every trigger, not just the first', () => {
  for (const [name, s] of triggers) {
    assert.equal(decide(state({ ...s, prefs: { enabled: false } })).reason, REASON.DISABLED, name);
  }
});

// [what the page already has, the decision for it, whether it is arranged
// again]. The decisions are made rather than written down, so the comparison is
// made of the same objects the Adapter obeys.
const on = (s) => decide(state(s));
const arrangements = [
  // Nothing standing: a page that has just been built, or one whose previous
  // arrangement was torn down for a navigation. Whatever the decision says, the
  // page is not arranged the way it asks for, so it is arranged again — which
  // is the whole of what navigation asks of this rule.
  ['no arrangement to leave alone', null, on({}), true],
  ['no arrangement, on a page that Stepped Aside', null, on({ page: { isTheater: true } }), true],
  // An arrangement already standing is left alone when the decision has not
  // moved — that is what keeps a run of resizes off the Comments.
  ['the same arrangement', on({}), on({}), false],
  ['the same Step Aside', on({ page: { isTheater: true } }), on({ page: { isTheater: true } }), false],
  // And re-made when any part of the decision moves.
  ['another width', on({ prefs: { paneWidth: 500 } }), on({ prefs: { paneWidth: 600 } }), true],
  ['another reason', on({ page: { isTheater: true } }), on({ page: { isShorts: true } }), true],
  ['a Step Aside where there was a layout', on({}), on({ page: { isTheater: true } }), true],
  ['a layout where there was a Step Aside', on({ page: { isTheater: true } }), on({}), true],
  // The same video, a different window: the width the page can carry moves with
  // it, so the Pane has to be re-made at the width the engine now resolves.
  ['a container that shrinks the Pane', on({ prefs: { paneWidth: 900 } }),
    on({ prefs: { paneWidth: 900 }, viewport: { width: 900, container: 900 } }), true],
];
for (const [name, last, decision, again] of arrangements) {
  test(`arranges again: ${name} — ${again}`, () => {
    assert.equal(needsArranging(last, decision), again);
  });
}

// The reason is what the popup renders, so a Step Aside that has changed its
// mind is a change even though the page looks the same.
test('a decision is compared by everything it carries', () => {
  const same = on({ page: { isTheater: true } });
  assert.equal(needsArranging(same, { ...same }), false);
  assert.equal(needsArranging(same, { ...same, action: ACTION.APPLY }), true);
  assert.equal(needsArranging(same, { ...same, reason: REASON.SHORTS }), true);
  assert.equal(needsArranging(same, { ...same, paneWidth: MIN_PANE_WIDTH }), true);
});

// [requested width, container, the width the Comment Pane takes]. The container
// is the box the Player and the Pane share, and the default here is an ordinary
// desktop one.
const widths = [
  // The default, and everything that isn't a usable number falling back to it.
  [500, 1920, 500],
  [0, 1920, DEFAULT_PANE_WIDTH],
  [-1, 1920, DEFAULT_PANE_WIDTH],
  [Infinity, 1920, DEFAULT_PANE_WIDTH],
  ['wide', 1920, DEFAULT_PANE_WIDTH],
  [null, 1920, DEFAULT_PANE_WIDTH],
  // The floor: 320px, the minimum YouTube applies to that column itself.
  [100, 1920, MIN_PANE_WIDTH],
  [MIN_PANE_WIDTH - 1, 1920, MIN_PANE_WIDTH],
  [MIN_PANE_WIDTH, 1920, MIN_PANE_WIDTH],
  [MIN_PANE_WIDTH + 1, 1920, MIN_PANE_WIDTH + 1],
  // The ceiling's first term, 60% of the container, which binds from 1200px up.
  [9999, 2000, 1200],
  [9999, 1200, 720],
  // The ceiling's second term, the container minus the narrowest measured
  // Player, which is the one that binds below 1200px.
  [9999, 1199, 719],
  [9999, 1000, 520],
  // Where both terms fall under the floor the floor wins — which is exactly the
  // viewport the engine Steps Aside on, so this is a decision, not a dead end.
  [9999, MIN_TWO_COLUMN_VIEWPORT, MIN_PANE_WIDTH],
  [9999, 700, MIN_PANE_WIDTH],
  // What the container spends on neither column — the gutter and the page's own
  // margin — is spent before the Player's share is worked out, so the second
  // term leaves the Player its measured width and not 48px less than it.
  [9999, 1000, 472, 48],
  [9999, 1200, 672, 48],
  [9999, 1199, 671, 48],
  // A chrome is not a share: where 60% of the container is the smaller term,
  // what the container spends around the columns moves nothing.
  [9999, 2000, 1200, 48],
  // A chrome that isn't a measurement constrains nothing.
  [9999, 1000, 520, 0],
  [9999, 1000, 520, NaN],
  [9999, 1000, 520, -48],
  [9999, 1000, 520, undefined],
];
for (const [requested, container, expected, chrome = 0] of widths) {
  test(`width: ${String(requested)} in a ${container}px container -> ${expected}`, () => {
    assert.equal(
      decide(
        state({ prefs: { paneWidth: requested }, viewport: { width: container, container, chrome } }),
      ).paneWidth,
      expected,
    );
  });
}

// The same rules, reached the way the Splitter reaches them, given the same two
// measurements the Adapter hands `decide`. One function, so the pointer and the
// keyboard cannot resolve a width differently — or differently from a decision.
const resolutions = [
  [402, 2000, 0, 402],
  [1180, 2000, 0, 1180],
  [1470, 2000, 0, 1200],
  [9999, 2000, 0, 1200],
  [10, 2000, 0, 320],
  [9999, 1000, 48, 472],
];
for (const [requested, container, chrome, expected] of resolutions) {
  test(`the Splitter resolves ${requested} in a ${container}px container to ${expected}`, () => {
    assert.equal(resolvePaneWidth(requested, container, chrome), expected);
  });
}
test('a container the page cannot measure leaves the floor and the default', () => {
  assert.equal(resolvePaneWidth(900, undefined), 900);
  assert.equal(resolvePaneWidth(null, undefined), DEFAULT_PANE_WIDTH);
  assert.equal(resolvePaneWidth(1, undefined), MIN_PANE_WIDTH);
});

// Where the two clamps meet is where the engine already Steps Aside.
test('the ceiling never undercuts the floor', () => {
  for (let container = 1; container <= 2000; container++) {
    assert.ok(paneCeiling(container) >= MIN_PANE_WIDTH, `container ${container}`);
  }
});
test('the second term is exactly the viewport the layout needs', () => {
  assert.equal(paneCeiling(MIN_TWO_COLUMN_VIEWPORT), MIN_PANE_WIDTH);
  assert.equal(MIN_TWO_COLUMN_VIEWPORT, MIN_PANE_WIDTH + MIN_PLAYER_WIDTH);
  // With chrome around the columns, the container has to be that much wider
  // again before the layout has the room it needs — which is the whole point of
  // the term: the Player's **column**, not the container, is what is measured
  // safe. Every container across the band where the term is the smaller one,
  // and the column it leaves behind.
  for (let container = MIN_TWO_COLUMN_VIEWPORT; container <= 1200; container++) {
    const ceiling = paneCeiling(container, 48);
    assert.ok(
      container - 48 - ceiling >= MIN_PLAYER_WIDTH || ceiling === MIN_PANE_WIDTH,
      `a ${container}px container clamps the Pane to ${ceiling}px, leaving the Player ${container - 48 - ceiling}px`,
    );
  }
});

// [how tall the Pane must be to end on the Strip, the viewport below its sticky
// top, the height it takes]. An ordinary window is 1080px tall under a 56px
// masthead, so 1024px is what there is to spend.
const heights = [
  // A description that fits: the Pane ends on the Strip, and the gap beside the
  // description is gone.
  [{ reach: 900, available: 1024 }, 900],
  [{ reach: 1023, available: 1024 }, 1023],
  [{ reach: 1024, available: 1024 }, 1024],
  // A description taller than the window: the window wins, so the end of the
  // thread stays above the fold.
  [{ reach: 1025, available: 1024 }, 1024],
  [{ reach: 4000, available: 1024 }, 1024],
  // A fraction of a pixel is a pixel: the Adapter writes a length, not a ratio.
  [{ reach: 1064.4, available: 1544 }, 1064],
  [{ reach: 1064.6, available: 1544 }, 1065],
  // A measurement that is missing constrains nothing; the other still does.
  [{ reach: null, available: 1024 }, 1024],
  [{ reach: undefined, available: 1024 }, 1024],
  [{ reach: 900, available: null }, 900],
  [{ reach: 4000, available: undefined }, 4000],
  // A Strip above the Pane, a window of nothing, a measurement that came back
  // as a word: none of them is a height, and none of them is a height of zero.
  [{ reach: 0, available: 1024 }, 1024],
  [{ reach: -20, available: 1024 }, 1024],
  [{ reach: NaN, available: 1024 }, 1024],
  [{ reach: 900, available: 0 }, 900],
  [{ reach: 900, available: -1 }, 900],
  // Nothing measured at all: the stylesheet's own default stands rather than a
  // height invented here.
  [{ reach: null, available: null }, null],
  [{ reach: NaN, available: NaN }, null],
];
for (const [{ reach, available }, height] of heights) {
  test(`pane height: ${reach} to the Strip in ${available} -> ${height}`, () => {
    assert.equal(resolvePaneHeight({ reach, available }), height);
  });
}

// The toolbar surface's whole answer, from what the page recorded. [what the
// surface is told, what it says].
const surfaces = [
  ['a page with the Pane on it', { applied: true }, { state: SURFACE.APPLIED, reason: null, canEnable: false }],
  // The layout is on the page, so the Pane is what the reader is looking at,
  // whatever the store or a stale reason says.
  ['a page that carries both markers', { applied: true, reason: REASON.THEATER, enabled: false },
    { state: SURFACE.APPLIED, reason: null, canEnable: false }],
  // The off switch: the one thing the surface can undo.
  ['the switch turned off, and the page says so', { reason: REASON.DISABLED },
    { state: SURFACE.OFF, reason: REASON.DISABLED, canEnable: true }],
  ['the switch turned off, on a page that has not decided yet', { enabled: false },
    { state: SURFACE.OFF, reason: REASON.DISABLED, canEnable: true }],
  // An automatic Step Aside: reported, and nothing to undo — turning the layout
  // "on" over a theater-mode page would be turning on nothing.
  ['an automatic Step Aside', { reason: REASON.THEATER },
    { state: SURFACE.STEPPED_ASIDE, reason: REASON.THEATER, canEnable: false }],
  ['another one', { reason: REASON.COMMENTS_DISABLED },
    { state: SURFACE.STEPPED_ASIDE, reason: REASON.COMMENTS_DISABLED, canEnable: false }],
  ['a page that is not a Watch Page', { reason: REASON.NOT_WATCH_PAGE },
    { state: SURFACE.STEPPED_ASIDE, reason: REASON.NOT_WATCH_PAGE, canEnable: false }],
  // A page that has said nothing: no markers of ours, or a reason that is not
  // ours to report.
  ['a page the extension never spoke for', {}, { state: SURFACE.ELSEWHERE, reason: null, canEnable: false }],
  ['a reason this engine never recorded', { reason: 'someone-elses-reason' },
    { state: SURFACE.ELSEWHERE, reason: null, canEnable: false }],
  ['a reason that is not a string', { reason: 42 }, { state: SURFACE.ELSEWHERE, reason: null, canEnable: false }],
  ['an unknown reason while the switch is off', { enabled: false, reason: 'someone-elses-reason' },
    { state: SURFACE.OFF, reason: REASON.DISABLED, canEnable: true }],
];
for (const [name, told, said] of surfaces) {
  test(`the toolbar surface on ${name}`, () => {
    assert.deepEqual(surfaceFor(told), said);
  });
}

test('the toolbar surface reads a page that has said nothing at all', () => {
  assert.deepEqual(surfaceFor(), { state: SURFACE.ELSEWHERE, reason: null, canEnable: false });
});

// A reason the surface cannot report is a reason nobody is told about, so every
// identifier the engine can record is held to being one it hands back — the off
// switch excepted, which it reports as the decision rather than as the store.
test('every reason the engine records is one the surface reports', () => {
  for (const reason of Object.values(REASON)) {
    const said = surfaceFor({ reason });
    assert.ok(
      said.reason === reason || (reason === REASON.DISABLED && said.state === SURFACE.OFF),
      `${reason} came back as ${JSON.stringify(said)}`,
    );
  }
});

// The popup renders these states, so renaming one is a user-visible change.
test('surface states are stable', () => {
  assert.deepEqual(SURFACE, {
    APPLIED: 'applied',
    OFF: 'off',
    STEPPED_ASIDE: 'stepped-aside',
    ELSEWHERE: 'elsewhere',
  });
});

// Both surfaces render these, and a reason with no sentence is a reason nobody
// is told about — so the tables are held against the engine's own vocabulary
// rather than against a second list that could fall behind it.
test('everything the engine can decide has something said about it', () => {
  for (const reason of Object.values(REASON)) {
    assert.equal(typeof WHY[reason], 'string', `nothing is said about ${reason}`);
  }
  for (const state of Object.values(SURFACE)) {
    assert.equal(typeof STATUS[state], 'string', `nothing is said about ${state}`);
  }
  assert.ok(ELSEWHERE_HINT.length > 0, 'the status view has nothing to say about a page with no Pane');
});

// The popup renders these strings, so renaming one is a user-visible change.
test('reason strings are stable', () => {
  assert.deepEqual(REASON, {
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
  });
});

test('does not mutate its input', () => {
  const s = state();
  const before = structuredClone(s);
  decide(s);
  assert.deepEqual(s, before);
});
