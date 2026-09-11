import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decide,
  resolvePaneWidth,
  paneCeiling,
  ACTION,
  REASON,
  PLACE,
  DEFAULT_PANE_WIDTH,
  MIN_PANE_WIDTH,
  MIN_PLAYER_WIDTH,
  MIN_TWO_COLUMN_VIEWPORT,
} from '../src/engine.js';

/** An ordinary desktop Watch Page: two columns by YouTube's own signal. */
const state = ({ viewport = {}, page = {}, prefs = {} } = {}) => ({
  viewport: { width: 1920, ...viewport },
  page: { isWatchPage: true, structureRecognised: true, isSingleColumn: false, ...page },
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
  ['comments disabled', { page: { commentsDisabled: true } }, REASON.COMMENTS_DISABLED],
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

// The spec's rule for overlaps: the reason reported is the first trigger that
// matches, and the order is the engine's to choose — so pin it down.
const firsts = [
  ['the off switch outranks everything', { prefs: { enabled: false }, page: { isShorts: true, isTheater: true } }, REASON.DISABLED],
  ['Shorts outranks another page', { page: { isShorts: true, isWatchPage: false } }, REASON.SHORTS],
  ['fullscreen outranks theater', { page: { isFullscreen: true, isTheater: true } }, REASON.FULLSCREEN],
  ['a live chat outranks an open panel', { page: { hasLiveChat: true, hasOpenPanel: true } }, REASON.LIVE_CHAT],
  ['a mode outranks the structure', { page: { isTheater: true, structureRecognised: false } }, REASON.THEATER],
  ['structure outranks no comments', { page: { structureRecognised: false, commentsDisabled: true } }, REASON.UNRECOGNISED_STRUCTURE],
  ['no room outranks no comments', { page: { commentsDisabled: true, isSingleColumn: true } }, REASON.SINGLE_COLUMN],
  ["YouTube's column outranks our viewport", { page: { isSingleColumn: true }, viewport: { width: 400 } }, REASON.SINGLE_COLUMN],
];
for (const [name, s, reason] of firsts) {
  test(`first trigger wins: ${name}`, () => {
    assert.equal(decide(state(s)).reason, reason);
  });
}

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
];
for (const [requested, container, expected] of widths) {
  test(`width: ${String(requested)} in a ${container}px container -> ${expected}`, () => {
    assert.equal(
      decide(state({ prefs: { paneWidth: requested }, viewport: { width: container, container } })).paneWidth,
      expected,
    );
  });
}

// The same rules, reached the way the Splitter reaches them. One function, so
// the pointer and the keyboard cannot resolve a width differently.
const resolutions = [
  [402, 2000, 402],
  [1180, 2000, 1180],
  [1470, 2000, 1200],
  [9999, 2000, 1200],
  [10, 2000, 320],
];
for (const [requested, container, expected] of resolutions) {
  test(`the Splitter resolves ${requested} in a ${container}px container to ${expected}`, () => {
    assert.equal(resolvePaneWidth(requested, container), expected);
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
