import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decide,
  ACTION,
  REASON,
  PLACE,
  DEFAULT_PANE_WIDTH,
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

const applies = [
  ['an ordinary Watch Page', {}],
  ['a viewport 400px narrower than YouTube needs', { viewport: { width: 700 } }],
  ['the fallback threshold exactly', { page: { isSingleColumn: null }, viewport: { width: MIN_TWO_COLUMN_VIEWPORT } }],
  ["YouTube's signal absent but room to spare", { page: { isSingleColumn: null } }],
];
for (const [name, s] of applies) {
  test(`applies: ${name}`, () => {
    assert.deepEqual(decide(state(s)), {
      action: ACTION.APPLY,
      paneWidth: DEFAULT_PANE_WIDTH,
      placement: { comments: PLACE.PANE, related: PLACE.NATIVE },
    });
  });
}

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

const widths = [
  [500, 500],
  [0, DEFAULT_PANE_WIDTH],
  [-1, DEFAULT_PANE_WIDTH],
  [Infinity, DEFAULT_PANE_WIDTH],
  ['wide', DEFAULT_PANE_WIDTH],
  [null, DEFAULT_PANE_WIDTH],
];
for (const [stored, expected] of widths) {
  test(`width: ${String(stored)} -> ${expected}`, () => {
    assert.equal(decide(state({ prefs: { paneWidth: stored } })).paneWidth, expected);
  });
}

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
