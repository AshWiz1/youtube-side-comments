/**
 * The path *into* a Watch Page — the one no other test covers.
 *
 * Every other navigation test begins from a Watch Page, where the content
 * script is already resident, so they all pass whether or not the script can
 * ever arrive. Ticket 15 found the Pane missing when a video was opened from
 * anywhere else: the document was created at a URL the manifest did not match,
 * so the script was never injected into it and nothing was there to notice the
 * in-page navigation.
 *
 * Kept in its own file because it is a different journey from the smoke suite's
 * and because ticket 14 is being written into that file concurrently.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launch, newPage, sleep } from '../test-support/cdp.mjs';

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), '..');
/** A non-Watch Page with video links. The signed-out home feed renders none. */
const FROM = 'https://www.youtube.com/results?search_query=music';

const SKIP = process.env.YSC_SKIP_SMOKE === '1' && 'YSC_SKIP_SMOKE=1';

/**
 * Click the first video link on the page, as a reader would — a real event, so
 * YouTube's own router does the navigating. A link with no box is YouTube's
 * skeleton, which no pointer can land on.
 */
async function clickVideo(page) {
  const box = await page.eval(`(() => {
    const a = [...document.querySelectorAll('a[href^="/watch"]')].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 120 && r.top > 80 && r.bottom < innerHeight - 40;
    });
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 40) };
  })()`);
  assert.ok(box, 'no clickable video link on the page navigated from');
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', buttons: 1, clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', buttons: 0, clickCount: 1 });
}

/**
 * Holds the related videos out of the document from the moment YouTube builds
 * them, until the test lets them back — which is the page this ticket is about:
 * the Comments ready and the related list not. It has to be a preload, because
 * the list is built by the arriving page's own script and the page arrived at
 * in-page is this very document.
 */
const HOLD_RELATED = `(() => {
  window.__born = performance.now();
  const held = [];
  const stow = document.createElement('div');
  window.__release = () => {
    for (const { node, parent, next } of held.splice(0)) {
      if (!parent.isConnected) continue;
      if (next && next.parentNode === parent) parent.insertBefore(node, next);
      else parent.append(node);
    }
    window.__released = true;
  };
  new MutationObserver((records) => {
    if (window.__released) return;
    for (const r of records) for (const n of r.addedNodes) {
      const node = n.id === 'related' ? n : n.nodeType === 1 && n.querySelector('#related');
      if (!node || held.some((h) => h.node === node)) continue;
      held.push({ node, parent: node.parentNode, next: node.nextSibling });
      stow.append(node);
      window.__held = held.length;
    }
  }).observe(document, { childList: true, subtree: true });
})();`;

describe('arriving at a Watch Page from a page that is not one', { skip: SKIP }, () => {
  let browser;
  let page;

  before(async () => {
    browser = await launch({ extension: EXTENSION });
    page = await newPage(browser, FROM);
    await page.waitFor(`!!document.querySelector('a[href^="/watch"]')`, 'a page of results', 60_000);

    // Chrome reports an isolated world over CDP asynchronously, so asserting the
    // moment the page is ready races the event. Wait for it here, once, rather
    // than asserting too early and calling a slow report a missing script.
    const until = Date.now() + 20_000;
    while (page.worlds.length === 0 && Date.now() < until) await sleep(200);
  });

  after(async () => {
    page?.close();
    await browser?.close();
  });

  test('the content script is resident before the Watch Page is reached', async () => {
    // Chrome creates an isolated world per injected content script. None means
    // the script is not here — and so cannot see the navigation that follows.
    assert.ok(
      page.worlds.length > 0,
      'no isolated world on the page we navigate from: the content script was never injected',
    );
  });

  test('clicking through arranges the Comment Pane, with no reload', async () => {
    await clickVideo(page);

    await page.waitFor(`location.pathname === '/watch'`, 'the Watch Page', 60_000);
    await page.waitFor(`!!document.getElementById('ysc-pane')`, 'the Comment Pane', 60_000);

    assert.ok(
      await page.eval(`!!document.getElementById('ysc-pane')`),
      'the Comment Pane did not appear after an in-page navigation into a Watch Page',
    );
  });

  test('the Recommendation Strip comes with it, below the Player', async () => {
    // Reported from use: arriving this way the recommendations are not there
    // below the video — and what the page holds is not a *missing* Strip but an
    // unseen one. Measured on this route, `#ysc-strip` was in the document
    // holding `#related` and every tile, at 0×0: the Search Page is left in the
    // document — `hidden`, with its own `#primary` inside it — so the Strip had
    // been placed after the columns of the page being left, while the Comment
    // Pane sat in the live rail. So what this test has to read is a box, not a
    // node: an invisible Strip satisfies every assertion a node can make.
    const r = JSON.parse(
      await page.eval(`JSON.stringify((() => {
        const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect();
          return { y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
        const strip = document.getElementById('ysc-strip');
        return {
          strip: box(strip),
          card: box(strip?.querySelector('yt-lockup-view-model, ytd-compact-video-renderer, ytd-compact-radio-renderer')),
          holdsRelated: !!strip?.querySelector('#related'),
          playerBottom: Math.round(document.querySelector('#player').getBoundingClientRect().bottom),
          stillInRail: !!document.querySelector('#secondary-inner #related'),
        };
      })())`),
    );

    assert.ok(r.strip, 'no Recommendation Strip after an in-page navigation into a Watch Page');
    assert.ok(r.holdsRelated, 'the related videos were left behind by the move');
    assert.ok(r.strip.w > 0 && r.strip.h > 0, `the Strip has no box on the page — ${JSON.stringify(r)}`);
    assert.ok(r.card?.w > 0 && r.card?.h > 0, `no related video has a box in the Strip — ${JSON.stringify(r)}`);
    assert.ok(r.strip.y >= r.playerBottom, `the Strip is not below the Player — ${JSON.stringify(r)}`);
    assert.equal(r.stillInRail, false, 'the related videos stayed in the rail');
  });

  test('a related list that arrives after the Comments still reaches the Strip', async () => {
    // The window this ticket is about, forced open: the related videos are held
    // out of the document from the moment YouTube builds them, so the page is
    // one whose Comments are ready and whose related list is not — whichever
    // order YouTube builds the two in, which on this route is a race and here
    // is a fact. The Comment Pane has to appear while the list is missing — it
    // is the feature, and holding the layout back for an element that may never
    // come is the one thing this must not do — and the Strip has to come to
    // hold the list when it arrives, with no reload.
    const held = await newPage(browser, FROM, { preload: HOLD_RELATED });
    try {
      await held.waitFor(`!!document.querySelector('a[href^="/watch"]')`, 'a page of results', 60_000);
      await clickVideo(held);
      await held.waitFor(`location.pathname === '/watch'`, 'the Watch Page', 60_000);
      await held.waitFor(`!!document.getElementById('ysc-pane')`, 'the Comment Pane', 60_000);

      const before = JSON.parse(await held.eval(`JSON.stringify({
        born: window.__born,
        heldOut: window.__held ?? 0,
        holdsRelated: !!document.querySelector('#ysc-strip #related'),
      })`));
      assert.ok(before.heldOut > 0, 'no related list was built, so none was held back');
      assert.equal(before.holdsRelated, false, 'the Strip holds a list that was held out of the document');

      // Only now does the list arrive — later than any window the bootstrap has
      // ever had, because the Pane is already up and its asking has stopped.
      await held.eval(`window.__release()`);
      await held.waitFor(`!!document.querySelector('#ysc-strip #related')`, 'the related videos in the Strip', 20_000);
      const after = JSON.parse(await held.eval(`JSON.stringify({
        born: window.__born,
        pane: !!document.getElementById('ysc-pane'),
        strip: (() => { const r = document.getElementById('ysc-strip').getBoundingClientRect();
          return { y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
        stillInRail: !!document.querySelector('#secondary-inner #related'),
      })`));
      assert.equal(after.born, before.born, 'the page was reloaded rather than re-arranged');
      assert.ok(after.pane, 'the Comment Pane did not survive the list arriving');
      assert.ok(after.strip.w > 0 && after.strip.h > 0, `the Strip has no box — ${JSON.stringify(after)}`);
      assert.equal(after.stillInRail, false, 'the related videos stayed in the rail');
    } finally {
      held.close();
    }
  });
});
