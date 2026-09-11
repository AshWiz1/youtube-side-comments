import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, ACTION, REASON, PLACE, DEFAULT_PANE_WIDTH } from '../src/engine.js';

const state = ({ page = {}, prefs = {} } = {}) => ({
  viewport: { width: 1920 },
  page: { isWatchPage: true, structureRecognised: true, ...page },
  prefs: { enabled: true, paneWidth: null, ...prefs },
});

const cases = [
  ['off switch', { prefs: { enabled: false } }, REASON.DISABLED],
  ['not a Watch Page', { page: { isWatchPage: false } }, REASON.NOT_WATCH_PAGE],
  ['unknown structure', { page: { structureRecognised: false } }, REASON.UNRECOGNISED_STRUCTURE],
];
for (const [name, s, reason] of cases) {
  test(`steps aside: ${name}`, () => {
    assert.deepEqual(decide(state(s)), { action: ACTION.STEP_ASIDE, reason });
  });
}

test('off switch outranks other reasons', () => {
  const s = state({ page: { isWatchPage: false }, prefs: { enabled: false } });
  assert.equal(decide(s).reason, REASON.DISABLED);
});

test('applies: comments to the pane, related left native', () => {
  assert.deepEqual(decide(state()), {
    action: ACTION.APPLY,
    paneWidth: DEFAULT_PANE_WIDTH,
    placement: { comments: PLACE.PANE, related: PLACE.NATIVE },
  });
});

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
  });
});

test('does not mutate its input', () => {
  const s = state();
  const before = structuredClone(s);
  decide(s);
  assert.deepEqual(s, before);
});
