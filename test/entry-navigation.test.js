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

    await page.waitFor(`location.pathname === '/watch'`, 'the Watch Page', 60_000);
    await page.waitFor(`!!document.getElementById('ysc-pane')`, 'the Comment Pane', 60_000);

    assert.ok(
      await page.eval(`!!document.getElementById('ysc-pane')`),
      'the Comment Pane did not appear after an in-page navigation into a Watch Page',
    );
  });
});
