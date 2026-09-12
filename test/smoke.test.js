/**
 * End-to-end smoke test: the extension in a real browser against a real Watch
 * Page.
 *
 * Everything impure lives behind this — reading the page, reparenting, the
 * layout CSS, the runtime module bootstrap — so this is where a broken Adapter
 * or a moved YouTube element has to show up. It drives headless Chrome over
 * CDP with no dependencies, on a **fresh profile every run**: a reused profile
 * carries theater mode, volume, autoplay and quality settings across runs,
 * which produces false results.
 *
 * Requires a network and Chrome, and takes about twenty seconds. It never skips
 * on its own — every problem, including an unreachable YouTube or a missing
 * Chrome, is a failure carrying the page state that caused it. `YSC_SKIP_SMOKE=1`
 * is the one deliberate way out, for offline runs.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launch, newPage, sleep } from '../test-support/cdp.mjs';
import { KEYBOARD_STEP } from '../src/splitter.js';

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), '..');
const WATCH_URL = process.env.YSC_SMOKE_URL || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
/** A second Watch Page, long enough not to end under the run, for checking that
 *  the width is a preference rather than a fact about one video. */
const OTHER_URL = process.env.YSC_SMOKE_URL_2 || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

/** A Watch Page whose related list serves **Shorts**. The Strip's own video
 *  serves none — measured across the videos this suite uses, and across fifteen
 *  others — so a rule about Shorts is only ever shown one here. Measured on this
 *  page: thirteen of the list's cards link to `/shorts/`. Its own list is long
 *  and builds as it is scrolled, so the Shorts on it are found by walking the
 *  Strip down. */
const SHORTS_URL = process.env.YSC_SMOKE_URL_SHORTS || 'https://www.youtube.com/watch?v=DLOUfAVwuXA';

/** Shared in-page helpers. `onScreen` is the only real visibility test: a
 *  non-zero box can still be scrolled out of a clipping ancestor. */
const PRELUDE = `
  const sig = (e) => e ? (e.tagName || '').toLowerCase() + (e.id ? '#' + e.id : '') : null;
  const chain = (e) => { const a = []; for (let n = e; n && n !== document.documentElement; n = n.parentElement) a.push(sig(n)); return a; };
  const onScreen = (e, clip) => {
    if (!e) return false;
    const r = e.getBoundingClientRect(), c = clip.getBoundingClientRect();
    return r.width > 0 && r.height > 0 &&
      r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top;
  };
`;

/**
 * Runs in the page before any of its own script, so the Native Layout can be
 * recorded the instant YouTube builds it — the one moment that is provably
 * "we never ran". `__paneSeen` then says whether the extension ever applied.
 */
const RECORD_NATIVE_LAYOUT = `
  window.__resizes = 0;
  window.__paneSeen = false;
  window.__native = null;
  window.__nativeRelated = null;
  window.__takenFrom = null;
  window.__putBack = null;
  addEventListener('resize', () => { window.__resizes++; });
  const sig = (e) => e ? (e.tagName || '').toLowerCase() + (e.id ? '#' + e.id : '') : null;
  const chain = (e) => { const a = []; for (let n = e; n && n !== document.documentElement; n = n.parentElement) a.push(sig(n)); return a; };
  const home = (e) => ({ parent: e.parentElement, chain: chain(e.parentElement),
    order: [...(e.parentElement?.children || [])].map(sig) });
  // Where the related list was taken from and where it was put back, both read
  // from the move itself. YouTube rearranges the page around us — it empties
  // the rail when the document goes fullscreen, related list and all — so a
  // position sampled even a moment either side of the move can be a fact about
  // YouTube's next layout rather than about where we put anything. The two
  // readings are of the same instant as the move, so they are comparable.
  const moved = (records) => {
    const has = (list) => [...list].some((n) => n.id === 'related');
    const intoStrip = records.some((r) => r.target.id === 'ysc-strip' && has(r.addedNodes));
    const outOfStrip = records.some((r) => r.target.id === 'ysc-strip' && has(r.removedNodes));
    for (const rec of records) {
      // Only the moves the Strip is party to are ours; YouTube moves the same
      // list about on its own account, and those moves are its business.
      if (rec.target.id === 'ysc-strip') continue;
      if (intoStrip && has(rec.removedNodes)) window.__takenFrom = { chain: chain(rec.target).join('<') };
      if (outOfStrip && has(rec.addedNodes)) window.__putBack = { chain: chain(rec.target).join('<') };
    }
  };
  const grab = (records) => {
    moved(records);
    if (records.some((r) => [...r.addedNodes].some((n) => n.id === 'ysc-pane'))) window.__paneSeen = true;
    // Recorded before the extension runs, never after: a home read once we have
    // moved something would record our own container as where it belongs.
    if (window.__paneSeen) return;
    const c = document.querySelector('#comments');
    if (c && !window.__native) window.__native = home(c);
    // The related list is *re-read* rather than latched on first sight. YouTube
    // builds its watch page in stages and replaces the rail's contents as the
    // response arrives, so first sight is a skeleton's position, not the one a
    // revert has to hit. The last read before we run is the one that is true.
    const r = document.querySelector('#related');
    if (r) window.__nativeRelated = home(r);
  };
  new MutationObserver(grab).observe(document, { childList: true, subtree: true });
  grab([]);
`;

/**
 * The related videos, whichever of YouTube's item elements is in circulation:
 * the lockup view model it ships now, or the compact renderer it shipped
 * before. Matching a tag YouTube has already replaced would quietly assert
 * nothing, so the set is deliberately broad.
 */
const CARD = 'ytd-compact-video-renderer, yt-lockup-view-model, ytd-compact-radio-renderer, ytd-compact-playlist-renderer';

/** A viewport clearly narrower than the default window and clearly wider than
 *  YouTube's own single-column breakpoint, so the Strip is measured re-laid out
 *  rather than measured collapsed. */
const NARROW_VIEWPORT = 1280;
const NARROW_STRIP = NARROW_VIEWPORT + 20;

/** Forces theater mode onto the watch root as the document is built, which is
 *  how theater mode actually reaches a page: persisted, not toggled. */
const LOAD_IN_THEATER = `
  const arm = () => {
    const root = document.querySelector('#primary')?.closest('[is-two-columns_],[is-single-column]')
      || document.querySelector('[is-two-columns_],[is-single-column]');
    if (root) root.setAttribute('theater', '');
  };
  new MutationObserver(arm).observe(document, { childList: true, subtree: true });
  arm();
`;

// An explicit, deliberate opt-out for offline runs — never an automatic one.
const SKIP = process.env.YSC_SKIP_SMOKE === '1' && 'YSC_SKIP_SMOKE=1';

describe('Comment Pane on a real Watch Page', { skip: SKIP }, () => {
  let browser;
  let page;

  before(async () => {
    browser = await launch({ extension: EXTENSION });
    page = await newPage(browser, WATCH_URL, { preload: RECORD_NATIVE_LAYOUT });

    try {
      await page.waitFor(`!!document.querySelector('#primary')`, 'a desktop Watch Page', 60_000);
      await page.waitFor(
        `!!document.querySelector('#ysc-pane ytd-comment-thread-renderer')`,
        'the Comments to load in the Comment Pane',
        90_000,
      );
    } catch (error) {
      // Never let this read as a product failure when the real cause is the
      // environment. Report what the browser actually had — including what the
      // extension made of it, because "no Pane" and "a Pane with no Comments in
      // it" are different faults and only one of them is ours.
      const seen = await page
        .eval(`(() => { const c = document.querySelector('#comments');
          const pane = document.getElementById('ysc-pane');
          return { url: location.href, title: document.title, h1: document.body.innerText.slice(0, 200),
            applied: document.documentElement.dataset.ysc || null,
            reason: document.documentElement.dataset.yscReason || null,
            pane: !!pane, paneThreads: pane ? pane.querySelectorAll('ytd-comment-thread-renderer').length : 0,
            region: c ? (c.hasAttribute('disable-upgrade') ? 'placeholder' : 'built') + ' kids=' + c.childElementCount : 'missing',
            header: !!c?.querySelector('ytd-comments-header-renderer'),
            threads: document.querySelectorAll('ytd-comment-thread-renderer').length }; })()`)
        .catch(() => ({}));
      throw new Error(
        `${error.message}\n  url:   ${seen.url}\n  title: ${seen.title}\n  page:  ${JSON.stringify(seen.h1)}\n` +
          `  ysc:   ${JSON.stringify({ applied: seen.applied, reason: seen.reason, pane: seen.pane, paneThreads: seen.paneThreads, region: seen.region, header: seen.header, threads: seen.threads })}\n` +
          `  extension id: ${browser.extensionId}\n  chrome: ${browser.stderr().slice(-400)}`,
      );
    }
    await sleep(2000); // let the last page of Comments settle before measuring
  });

  after(async () => {
    page?.close();
    await browser?.close();
  });

  /** A Step Aside is only honest if the page is indistinguishable from one the
   *  extension never ran on: exactly the Native Layout, plus the reason. */
  const stepAside = async (reason) => {
    await page.waitFor(
      `document.documentElement.dataset.yscReason === '${reason}'`,
      `a Step Aside for ${reason}`,
      15_000,
    );
    const r = await page.eval(`(() => { ${PRELUDE}
      const comments = document.querySelector('#comments');
      const related = document.querySelector('#related');
      // Wrapped in :is() rather than left as a bare list: in a comma-separated
      // selector only the first term would be scoped to the rail, and the rest
      // would count any card anywhere on the page.
      const cards = [...document.querySelectorAll('#secondary-inner #related :is(${CARD})')];
      const lefts = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left)));
      const orderOf = (e) => [...(e?.parentElement?.children ?? [])].map(sig);
      const common = (a, b) => a.filter((s) => b.includes(s)).join('>');
      return {
        reason: document.documentElement.dataset.yscReason ?? null,
        applied: document.documentElement.dataset.ysc ?? null,
        inline: document.documentElement.style.getPropertyValue('--ysc-pane-width'),
        pane: !!document.getElementById('ysc-pane'),
        strip: !!document.getElementById('ysc-strip'),
        residue: [...document.querySelectorAll('body *')]
          .filter((e) => (e.id || '').includes('ysc') || [...e.attributes].some((a) => a.name.includes('ysc'))).length,
        sameParent: comments?.parentElement === window.__native?.parent,
        chain: chain(comments?.parentElement).join('<'),
        nativeChain: (window.__native?.chain || []).join('<'),
        // Position as *relative order*, for the reason the related videos'
        // is: YouTube rearranges the page under us while we are arranged —
        // it moved the related list into the Comments' own container during a
        // run, which no immediate-neighbour comparison survives, and which is
        // its business, not ours. The order of the elements that are in both
        // readings is ours, and any misplacement by us changes it.
        orderNow: common(orderOf(comments), window.__native?.order ?? []),
        orderThen: common(window.__native?.order ?? [], orderOf(comments)),
        inRail: !!document.querySelector('#secondary-inner #comments'),
        relatedAlive: !!related && !document.getElementById('ysc-strip')?.contains(related),
        // The exact parent, in the one form YouTube's own churn cannot spoil:
        // read from the move itself, once when the list is taken and once when
        // it is put back, so the two are comparable however the page moved in
        // between. A chain rather than the element, because the elements that
        // hold it are exactly what YouTube relocates.
        takenFrom: window.__takenFrom?.chain ?? null,
        putBack: window.__putBack?.chain ?? null,
        // Position asserted as *relative order* rather than as immediate
        // neighbours. The rail's ad slots come and go — #donation-shelf was
        // measured vanishing between the recording and the revert — and a
        // neighbour YouTube itself deleted is not a fact about where we put
        // anything. The order of the elements that are there in both readings
        // is, and it is invariant under YouTube adding or removing its own.
        relatedOrderNow: common(orderOf(related), window.__nativeRelated?.order ?? []),
        relatedOrderThen: common(window.__nativeRelated?.order ?? [], orderOf(related)),
        // Back to the rail's own single column, not just back in the rail: the
        // grid was ours, so leaving it behind would be residue of the layout.
        relatedColumns: lefts.size,
        // Carried only so a failure says why: where the list sits now, and how
        // many copies of it YouTube has in the page at all — with what each of
        // them holds, because a second copy is only a problem if it is a list.
        relatedCopies: [...document.querySelectorAll('#related')].map((e) => ({
          inRail: !!e.closest('#secondary-inner'),
          parent: sig(e.parentElement),
          cards: e.querySelectorAll('${CARD}').length,
          columns: new Set([...e.querySelectorAll('${CARD}')].map((c) => Math.round(c.getBoundingClientRect().left))).size,
        })),
        relatedParent: sig(related?.parentElement),
      };
    })()`);
    const why = ` (${JSON.stringify({
      relatedParent: r.relatedParent, copies: r.relatedCopies,
      chain: r.chain, nativeChain: r.nativeChain,
      now: r.relatedOrderNow, then: r.relatedOrderThen,
    })})`;

    assert.equal(r.reason, reason, 'the Step Aside reason was not recorded');
    assert.equal(r.applied, null, 'the root still carries the layout attribute');
    assert.equal(r.inline, '', 'an inline pane width was left on the root');
    assert.equal(r.pane, false, 'the Comment Pane was left behind');
    assert.equal(r.strip, false, 'the Recommendation Strip was left behind');
    assert.equal(r.residue, 0, 'the extension left its own attributes on the page');
    assert.equal(r.sameParent, true, 'the Comments are not back at their exact original parent');
    assert.equal(r.chain, r.nativeChain, 'the Comments are back at the wrong nesting depth');
    assert.equal(r.orderNow, r.orderThen, 'the Comments moved within their original parent');
    assert.equal(r.inRail, false, 'the Comments are still in the right rail');
    assert.equal(r.relatedAlive, true, `the related videos were destroyed or left in our container${why}`);
    assert.equal(r.putBack, r.takenFrom, `the related videos were not put back exactly where they were taken from${why}`);
    assert.equal(r.relatedOrderNow, r.relatedOrderThen, `the related videos moved within their parent${why}`);
    // Nothing of the Strip's grid survives; the rail's own list is one column.
    // Zero cards is the one layout where YouTube keeps the related videos
    // somewhere else entirely — theater mode puts them below the Player — and
    // there is no grid there to be rid of.
    assert.ok(r.relatedColumns <= 1, `the related videos kept the Recommendation Strip’s grid instead of a native column${why}`);
  };

  /** Put a forced page fact back and let the extension re-decide, so that the
   *  next test starts from an applied layout rather than a stepped-aside one. */
  const reapply = async () => {
    await page.eval(`window.dispatchEvent(new CustomEvent('yt-navigate-finish'))`);
    await page.waitFor(`document.documentElement.dataset.ysc === 'on'`, 'the layout to be applied', 15_000);
  };

  test('the Comment Pane exists and holds the Comments', async () => {
    const r = await page.eval(`(() => {
      const pane = document.querySelector('#ysc-pane');
      // The bare <ytd-comments> tag matches a second, hidden element, so
      // selecting on the tag alone picks the wrong one.
      const hidden = [...document.querySelectorAll('ytd-comments')].filter((c) => c.id !== 'comments');
      const box = pane?.getBoundingClientRect();
      return {
        inRail: !!document.querySelector('#secondary-inner > #ysc-pane'),
        holdsComments: !!pane?.contains(document.querySelector('#comments')),
        selectedId: document.querySelector('#comments')?.id ?? null,
        movedTheWrongOne: hidden.some((c) => pane?.contains(c)),
        width: box ? +box.width.toFixed(1) : 0,
      };
    })()`);

    assert.equal(r.inRail, true, "the Comment Pane is not hosted in YouTube's right rail");
    assert.equal(r.holdsComments, true, 'the Comment Pane does not hold the Comments');
    assert.equal(r.selectedId, 'comments', 'the element carrying #comments was not the one moved');
    assert.equal(r.movedTheWrongOne, false, 'the second, hidden ytd-comments element was moved');
    assert.ok(
      Math.abs(r.width - 402) <= 1,
      `the Comment Pane is ${r.width}px wide, not the configured 402px`,
    );
  });

  test('the Comments loaded on their own, with nothing left loading', async () => {
    const r = await page.eval(`(() => { ${PRELUDE}
      const pane = document.querySelector('#ysc-pane');
      const threads = [...pane.querySelectorAll('ytd-comment-thread-renderer')];
      return {
        threads: threads.length,
        firstOnScreen: onScreen(threads[0], pane),
        firstText: (threads[0]?.innerText || '').trim(),
        header: (pane.querySelector('ytd-comments-header-renderer')?.innerText || '').replace(/\\s+/g, ' ').trim(),
        spinnerOnScreen: [...pane.querySelectorAll('tp-yt-paper-spinner')].filter((s) => onScreen(s, pane)).length,
        scrolls: pane.scrollHeight > pane.clientHeight + 5,
        // These are YouTube's own controls, moved rather than rebuilt — which
        // is the whole reason replies, sorting and liking still work.
        sort: pane.querySelectorAll('yt-sort-filter-sub-menu-renderer').length,
        composer: pane.querySelectorAll('ytd-comment-simplebox-renderer, #simple-box').length,
        likes: pane.querySelectorAll('#like-button').length,
        replies: pane.querySelectorAll('#reply-button-end').length,
      };
    })()`);

    assert.ok(r.threads > 0, 'no Comments rendered — the pane is empty');
    assert.equal(r.firstOnScreen, true, 'the first comment thread is not visible inside the Comment Pane');
    assert.ok(r.firstText.length > 20, `the first comment thread has no content: ${JSON.stringify(r.firstText)}`);
    assert.ok(/comment/i.test(r.header), `the comments header did not render: ${JSON.stringify(r.header)}`);
    assert.equal(r.spinnerOnScreen, 0, 'a loading spinner is still visible in the Comment Pane');
    assert.equal(r.scrolls, true, 'the Comment Pane does not scroll on its own');
    assert.ok(
      r.sort && r.composer && r.likes && r.replies,
      `the Comment Pane lost YouTube's own controls: ${JSON.stringify(r)}`,
    );
  });

  test('the Player keeps the left column and never overlaps the Comment Pane', async () => {
    const r = await page.eval(`(() => {
      const box = (s) => { const e = document.querySelector(s); if (!e) return null;
        const { left, right, top, width, height } = e.getBoundingClientRect();
        return { left, right, top, width, height }; };
      return { player: box('#player'), pane: box('#ysc-pane') };
    })()`);

    assert.ok(r.pane && r.player, 'the Player or the Comment Pane is missing');
    assert.ok(
      r.pane.left >= r.player.right,
      `the Comment Pane overlaps the Player by ${(r.player.right - r.pane.left).toFixed(1)}px`,
    );
    assert.ok(r.player.left < r.pane.left, 'the Player is not the left column');
    assert.ok(
      Math.abs(r.pane.top - r.player.top) < 2,
      `the Comment Pane is not beside the Player (top ${r.pane.top} vs ${r.player.top})`,
    );
  });

  /** The Pane's box and the two numbers its height is made of, read in one
   *  frame: how far it is to the Recommendation Strip, and what the window
   *  allows below the Pane's own sticky top. */
  const paneHeight = () => page.eval(`(() => {
    const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
      return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), height: +b.height.toFixed(1) }; };
    const pane = document.querySelector('#ysc-pane');
    const rail = document.querySelector('#secondary-inner');
    const strip = document.getElementById('ysc-strip');
    const sticky = parseFloat(getComputedStyle(pane).top) || 0;
    return {
      pane: box(pane), strip: box(strip),
      // Measured from the columns' top, which is where the Pane begins before
      // it is stuck, exactly as the Adapter measures it.
      reach: +(box(strip).top - box(rail).top).toFixed(1),
      available: document.documentElement.clientHeight - sticky,
      viewport: document.documentElement.clientHeight,
      // The Pane's own bottom edge, and whether it is drawn: where the Comments
      // end is not otherwise visible on a page whose surface it shares.
      edge: [
        getComputedStyle(pane).borderBottomWidth,
        getComputedStyle(pane).borderBottomColor,
        getComputedStyle(pane).boxSizing,
      ],
    };
  })()`);

  test('the Comment Pane is never taller than the window, and stops there when it must', async () => {
    const r = await paneHeight();
    assert.ok(r.pane && r.strip, 'the Comment Pane or the Recommendation Strip is missing');
    // The rule, measured rather than restated: as tall as it takes to reach the
    // Strip, or as much as the window has room for, whichever is less.
    assert.ok(
      Math.abs(r.pane.height - Math.min(r.reach, r.available)) <= 2,
      `the Comment Pane is ${r.pane.height}px tall, where the Strip needs ${r.reach}px and the window allows ${r.available}px`,
    );
    // And what the cap buys: the Pane's sticky top holds it under the masthead,
    // so the end of the thread is never past the fold.
    assert.ok(
      r.pane.height <= r.viewport,
      `the Comment Pane is ${r.pane.height}px tall in a ${r.viewport}px window`,
    );
    assert.ok(
      r.pane.height <= r.available + 1,
      `the Comment Pane is ${r.pane.height}px tall with ${r.available}px below its sticky top`,
    );
    // Legible, and without costing the Pane a pixel of the height it was given.
    assert.deepEqual(r.edge, ['1px', 'rgba(128, 128, 128, 0.4)', 'border-box'], 'the Pane has no bottom edge');
  });

  test('the Comment Pane reaches the Recommendation Strip where the description fits', async () => {
    // The one page state in which the two halves of the rule can be told apart:
    // a window tall enough that reaching the Strip is not also too tall to show.
    // The width is left exactly as it is, so the page re-lays out no differently
    // — only the room below it changes.
    const { viewport } = await paneHeight();
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: await page.eval('innerWidth'), height: 1400, deviceScaleFactor: 1, mobile: false,
    });
    await page.waitFor(
      `(() => { const p = document.querySelector('#ysc-pane');
        return !!p && p.getBoundingClientRect().height > ${viewport}; })()`,
      'the Comment Pane to take the room the taller window gives it',
      15_000,
    );
    const r = await paneHeight();
    // The precondition, read rather than assumed: the description fits now, so
    // an unmoved Pane would be the layout rather than the cap.
    assert.ok(
      r.reach <= r.available + 1,
      `the page still does not fit — the Strip needs ${r.reach}px of a ${r.available}px window`,
    );
    assert.ok(
      Math.abs(r.pane.bottom - r.strip.top) <= 2,
      `the Comment Pane ends at ${r.pane.bottom} where the Recommendation Strip begins at ${r.strip.top}` +
        ` — ${(r.strip.top - r.pane.bottom).toFixed(1)}px of dead space beside the description`,
    );

    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.waitFor(
      `(() => { const p = document.querySelector('#ysc-pane');
        return !!p && p.getBoundingClientRect().height < ${r.pane.height - 1}; })()`,
      'the Comment Pane to come back to the window it had',
      15_000,
    );
  });

  test("the Player's internals are resynced to its own frame", async () => {
    const r = await page.eval(`(() => {
      const mp = document.querySelector('#movie_player');
      const video = document.querySelector('#movie_player video');
      const bar = document.querySelector('#movie_player .ytp-chrome-bottom');
      const w = (e) => (e ? e.getBoundingClientRect().width : null);
      const resizesBefore = window.__resizes;
      // Re-apply through the real lifecycle event, so the resize the Adapter
      // dispatches on every apply is observed rather than assumed.
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      return {
        frame: w(mp),
        video: w(video),
        bar: w(bar),
        // YouTube writes the Player's internal sizes as inline pixels and
        // refreshes them only on window resize, attaching no observer.
        inline: video ? parseFloat(video.style.width) : null,
        resizes: window.__resizes - resizesBefore,
      };
    })()`);

    assert.ok(r.frame > 0 && r.video > 0, 'no video element');
    assert.ok(
      r.resizes > 0,
      'applying the layout dispatched no resize, so the Player cannot resync its internals',
    );
    assert.ok(
      r.video - r.frame <= 1,
      `the <video> overflows its Player frame by ${(r.video - r.frame).toFixed(1)}px`,
    );
    assert.ok(
      Math.abs(r.inline - r.frame) <= 2,
      `the <video> is ${r.inline}px inside a ${r.frame.toFixed(0)}px frame — the Player's internals kept a stale width`,
    );
    assert.ok(
      r.bar === null || r.bar - r.frame <= 1,
      `the control bar overflows its Player frame by ${(r.bar - r.frame).toFixed(1)}px`,
    );
  });

  test("the page keeps its own metadata, and its rail keeps its own panels", async () => {
    const r = await page.eval(`(() => {
      const chain = (e) => { const a = []; for (let n = e; n && n !== document.body; n = n.parentElement) a.push(n.id || n.tagName.toLowerCase()); return a; };
      const meta = document.querySelector('ytd-watch-metadata');
      return {
        metaChain: meta ? chain(meta).join('<') : null,
        metaWidth: meta ? +meta.getBoundingClientRect().width.toFixed(0) : 0,
        title: (document.querySelector('ytd-watch-metadata h1')?.innerText || '').trim(),
        channel: !!document.querySelector('#primary ytd-video-owner-renderer'),
        actions: !!document.querySelector('#primary #actions'),
        description: !!document.querySelector('#primary #description, #primary #description-inline-expander'),
        rail: [...document.querySelectorAll('#secondary-inner > *')].map((e) => e.id || e.tagName.toLowerCase()),
      };
    })()`);

    // The exact nesting depth is the assertion: the Comments sit behind an
    // extra wrapper inside #below, and the metadata must not have moved with them.
    assert.ok(r.metaChain?.includes('below'), `the video metadata moved: ${r.metaChain}`);
    assert.ok(r.metaChain?.includes('primary'), `the video metadata left the Player column: ${r.metaChain}`);
    assert.ok(!r.rail.includes('ytd-watch-metadata'), 'the video metadata was dragged into the rail');
    assert.ok(r.metaWidth > 0, 'the video metadata has no box');
    assert.ok(r.title.length > 0, 'the video title is missing');
    assert.ok(r.channel && r.actions && r.description, 'the channel row, actions or description is missing');
    // The related videos are the one occupant that leaves the rail — that is
    // the Recommendation Strip, and it is deliberate. Everything else YouTube
    // put in that column stays in it.
    for (const id of ['panels', 'playlist', 'chat-container']) {
      assert.ok(r.rail.includes(id), `${id} was displaced from the rail: ${r.rail.join(', ')}`);
    }
    assert.ok(!r.rail.includes('related'), `the related videos are still in the rail: ${r.rail.join(', ')}`);
  });

  // ------------------------------------------------------- Recommendation Strip

  /** Every number the Strip's claims are made of, read fresh from the page. */
  const stripGeometry = () => page.eval(`(() => { ${PRELUDE}
    const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
      return { left: +b.left.toFixed(1), right: +b.right.toFixed(1), top: +b.top.toFixed(1),
               bottom: +b.bottom.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1) }; };
    const strip = document.getElementById('ysc-strip');
    const cards = [...(strip?.querySelectorAll('${CARD}') || [])];
    const drawn = cards.filter((c) => c.getBoundingClientRect().width > 0);
    // A Short, by the one thing that says so: its own link goes to /shorts/.
    // Measured on a related list holding thirteen of them — a Short there is the
    // same lockup as every other card, with YouTube's own badge on it.
    const shorts = cards.filter((c) => c.querySelector('a[href*="/shorts/"]'));
    // Rows, by vertical overlap rather than by an equal top edge: an inline-block
    // card sits a few pixels off the top of the row it is in.
    const rows = [];
    for (const c of [...drawn].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)) {
      const b = c.getBoundingClientRect();
      const row = rows.find((r) => Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 20);
      if (row) { row.n++; row.bottom = Math.max(row.bottom, b.bottom); }
      else rows.push({ top: b.top, bottom: b.bottom, n: 1 });
    }
    return {
      strip: box(strip),
      player: box(document.querySelector('#player')),
      pane: box(document.querySelector('#ysc-pane')),
      rail: box(document.querySelector('#secondary-inner')),
      belowColumns: strip ? strip.getBoundingClientRect().top >= document.querySelector('#primary').getBoundingClientRect().bottom - 1 : false,
      cards: cards.length,
      card: box(cards[0]),
      // What a card is made of: the thumbnail a tile carries above its text.
      thumb: box(cards[0]?.querySelector('yt-thumbnail-view-model')),
      // One distinct left edge per column of the grid — and exactly one if the
      // list is still the rail's single, stretched column.
      columns: new Set(drawn.map((c) => Math.round(c.getBoundingClientRect().left))).size,
      // The rows that hold one card and nothing else, the list's own last row
      // aside — a list simply ends, and where it ends is not a shape. Every
      // other one is a card dictating a row of its own.
      loneRows: rows.slice(0, -1).filter((r) => r.n === 1).length,
      rows: rows.length,
      shorts: shorts.length,
      short: box(shorts[0]),
      shortThumb: box(shorts[0]?.querySelector('yt-thumbnail-view-model')),
      hiddenShorts: shorts.filter((c) => { const b = c.getBoundingClientRect();
        return b.width < 1 || getComputedStyle(c).display === 'none' || getComputedStyle(c).visibility === 'hidden'; }).length,
      text: (cards[0]?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      // Only so an overflow failure names the element rather than the number.
      widest: [...document.querySelectorAll('body *')]
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.right > document.documentElement.clientWidth + 0.5)
        .sort((a, b) => b.r.right - a.r.right).slice(0, 3)
        .map(({ e, r }) => sig(e) + ' ' + Math.round(r.left) + '-' + Math.round(r.right) + ' in ' + sig(e.parentElement)),
    };
  })()`);

  test('the Recommendation Strip is below the Player and the Pane, not beside them', async () => {
    const r = await stripGeometry();
    assert.ok(r.strip && r.player && r.pane, 'the Strip, the Player or the Comment Pane is missing');
    assert.equal(
      await page.eval(`!!document.querySelector('#secondary-inner #related')`),
      false,
      'the related videos are still in the right rail',
    );
    assert.ok(
      r.strip.top >= r.player.bottom - 1,
      `the Strip starts at ${r.strip.top}, inside the Player which ends at ${r.player.bottom}`,
    );
    assert.ok(
      r.strip.top >= r.pane.bottom - 1,
      `the Strip starts at ${r.strip.top}, inside the Comment Pane which ends at ${r.pane.bottom}`,
    );
    assert.ok(
      r.strip.width >= r.player.width + r.pane.width,
      `the Strip is ${r.strip.width}px wide, narrower than the ${(r.player.width + r.pane.width).toFixed(0)}px the Player and the Pane span`,
    );
    assert.equal(r.belowColumns, true, 'the Strip is not below the box the Player and the Pane share');

    // No dead column. The region the Strip vacated is the Comment Pane's, and
    // the width it published is covered by the Strip below the columns.
    assert.ok(
      Math.abs(r.pane.width - r.rail.width) <= 2,
      `the Comment Pane is ${r.pane.width}px wide in a ${r.rail.width}px rail, leaving a gap`,
    );
    assert.ok(
      r.strip.left <= r.rail.left + 1 && r.strip.right >= r.rail.right - 1,
      `the Strip spans ${r.strip.left}–${r.strip.right}, not the rail's ${r.rail.left}–${r.rail.right}`,
    );
  });

  test('the related videos loaded in the Strip, laid out for the width they now have', async () => {
    const r = await stripGeometry();
    assert.ok(r.cards > 5, `only ${r.cards} related videos rendered in the Strip`);
    assert.ok(r.text.length > 10, `the first related video has no content: ${JSON.stringify(r.text)}`);
    // Four to a row at the wide viewport, and the card is a tile rather than a
    // rail row: measured at a 1889px Strip, four columns of 452×374 with a
    // 452×254 thumbnail above the text, where the 320px floor gave five of
    // 359×134 with a 224px thumbnail beside it.
    assert.equal(
      r.columns,
      4,
      `the related videos sit in ${r.columns} column(s) of ${r.card?.width}px — four to a row is the Strip's width`,
    );
    assert.ok(
      r.card.width > 420 && r.card.height > 300,
      `a related video is ${r.card.width}×${r.card.height}, which is a rail row at page width, not a tile`,
    );
    assert.ok(
      r.thumb && Math.abs(r.thumb.width / r.thumb.height - 16 / 9) < 0.06 && Math.abs(r.thumb.width - r.card.width) <= 1,
      `a tile's thumbnail is ${JSON.stringify(r.thumb)} in a ${JSON.stringify(r.card)} card — the tile is not a 16:9 thumbnail over its text`,
    );
    // No card has a row to itself: a card that arrives in a shape of its own
    // would stretch every card beside it, and Shorts are the shape that does it.
    assert.equal(r.loneRows, 0, `${r.loneRows} of ${r.rows} rows hold one card and nothing else`);
    assert.equal(r.overflow, 0, `the page scrolls sideways by ${r.overflow}px: ${JSON.stringify(r.widest)}`);
  });

  test('the Strip keeps its grid at a narrower viewport, and gives the rail back its column', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: NARROW_VIEWPORT, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    // Waited for the Strip's own box, not the layout attribute: the attribute is
    // already on, and the page has not re-laid itself out until the box moves.
    await page.waitFor(`document.documentElement.dataset.ysc === 'on'`, 'the layout at 1280px', 15_000);
    await page.waitFor(
      `(() => { const s = document.getElementById('ysc-strip'); return !!s && s.getBoundingClientRect().width < ${NARROW_STRIP}; })()`,
      `the Strip to take the narrower viewport`,
      15_000,
    );
    const narrow = await stripGeometry();
    assert.ok(narrow.strip && narrow.strip.width < NARROW_STRIP, `no Strip at a narrow viewport: ${JSON.stringify(narrow.strip)}`);
    // Three at 1280 rather than the four a wider window takes: a 1248px Strip
    // holds three 380px columns and not four, which is the floor doing the
    // deciding and not a count written down.
    assert.ok(
      narrow.columns >= 3,
      `the Strip fell back to ${narrow.columns} column(s) at 1280px, which is the layout the Strip exists to avoid`,
    );
    assert.equal(narrow.overflow, 0, `the page scrolls sideways by ${narrow.overflow}px at 1280: ${JSON.stringify(narrow.widest)}`);

    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.waitFor(`document.documentElement.dataset.ysc === 'on'`, 'the layout to come back', 15_000);
    await page.waitFor(
      `(() => { const s = document.getElementById('ysc-strip'); return !!s && s.getBoundingClientRect().width > 1600; })()`,
      'the Strip to take the wide viewport back',
      15_000,
    );
  });

  test('Shorts in the Strip are cards among the others, not rows of their own', async (t) => {
    // A fixture of its own, because the Strip's video serves no Shorts and a rule
    // about Shorts that is never shown one asserts nothing. This one held
    // thirteen among its list's cards when it was measured, every one of them a
    // `yt-lockup-view-model` whose link goes to /shorts/ — the same element as
    // every other card, with YouTube's own "Shorts" badge on it.
    await page.send('Page.navigate', { url: SHORTS_URL });
    await page.waitFor(
      `!!document.querySelector('#ysc-pane ytd-comment-thread-renderer')`,
      'a Watch Page whose related list serves Shorts',
      90_000,
    );
    // The list builds as it is scrolled down, so the Shorts further along it only
    // exist once the Strip has been walked. A tile is 374px of a column now, so
    // the walk is in steps of a row and a half.
    for (let i = 0; i < 8; i++) {
      await page.eval(`(() => { const s = document.getElementById('ysc-strip');
        if (s) scrollTo(0, s.getBoundingClientRect().top + scrollY + ${i} * 1200); return true; })()`);
      await sleep(1000);
    }
    await page.eval(`scrollTo(0, 0)`);
    await sleep(1000);

    const r = await stripGeometry();
    assert.ok(r.cards > 5, `only ${r.cards} related videos rendered in the Strip`);
    assert.equal(r.overflow, 0, `the page scrolls sideways by ${r.overflow}px: ${JSON.stringify(r.widest)}`);
    // The criterion, measured on whatever the page serves: no card holds a row on
    // its own — the list's own last row aside, which is short because the list
    // ended there. Every page this suite loads is measured this way, so a Short
    // that arrives in a shape of its own fails the same assertion wherever it is.
    assert.equal(r.loneRows, 0, `${r.loneRows} of ${r.rows} rows hold one card and nothing else`);
    t.diagnostic(`${r.shorts} of ${r.cards} related cards are Shorts, in ${r.rows} rows`);

    if (r.shorts) {
      assert.equal(r.hiddenShorts, 0, 'a Short in the Strip was hidden rather than laid out');
      // A Short is a card like its neighbours: the same column, the same tile,
      // its thumbnail the same 16:9 box — cropped, as YouTube crops one wherever
      // it shows a Short in a 16:9 slot, rather than stretched to a row's height.
      assert.ok(
        Math.abs(r.short.width - r.card.width) <= 1 && r.short.height > 300,
        `a Short is ${r.short.width}×${r.short.height} against a ${r.card.width}×${r.card.height} card`,
      );
      assert.ok(
        r.shortThumb && Math.abs(r.shortThumb.width / r.shortThumb.height - 16 / 9) < 0.06,
        `a Short's thumbnail is ${JSON.stringify(r.shortThumb)} — not the 16:9 box its row is built from`,
      );
    }
  });

  test('theater mode Steps Aside and restores the Native Layout exactly', async () => {
    // Theater mode persists across loads, so YouTube's own signal for it is an
    // attribute on the watch root — forced directly here rather than clicked
    // for, since the extension's whole input is that attribute.
    const on = await page.eval(`(() => {
      const root = document.querySelector('#primary')?.closest('[is-two-columns_],[is-single-column]');
      root.setAttribute('theater', '');
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      return !!root;
    })()`);
    assert.equal(on, true, 'no watch root to put into theater mode');

    await stepAside('theater');

    await page.eval(`(() => {
      document.querySelector('[theater]').removeAttribute('theater');
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      return true;
    })()`);
    await page.waitFor(`document.documentElement.dataset.ysc === 'on'`, 'the layout to come back', 15_000);
    assert.equal(
      await page.eval(`!!document.querySelector('#ysc-pane #comments')`),
      true,
      'the Comments did not return to the Comment Pane after theater mode ended',
    );
  });

  test("YouTube's own single column Steps Aside, and outranks our viewport guard", async () => {
    // Narrower than both YouTube's breakpoint and our own fallback: the reason
    // recorded has to be YouTube's signal, because a layout applied inside a
    // column YouTube has hidden is how the Comments silently disappear. No
    // lifecycle event is fired here — narrowing the window is the whole trigger.
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 700, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await stepAside('single-column');

    // And widening it back brings the layout back, rather than leaving the page
    // stepped aside for a column that is two columns wide again.
    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.waitFor(`document.documentElement.dataset.ysc === 'on'`, 'the layout to come back', 15_000);
  });

  test("YouTube's own panels Step Aside while they compete for the column", async () => {
    // An ordinary expanded panel stacks vertically and takes nothing from the
    // rail, so what is guarded against is the horizontally-docking family that
    // sits dormant in YouTube's stylesheets — forced here, exactly as theater
    // mode is, because a dormant flag is not reachable through YouTube's UI.
    const expanded = await page.eval(`(() => {
      const panel = document.querySelector('#panels ytd-engagement-panel-section-list-renderer');
      if (!panel) return 'no panel in the rail';
      panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      return 'expanded';
    })()`);
    assert.equal(expanded, 'expanded', expanded);
    await stepAside('open-panel');

    await page.eval(`(() => {
      document.querySelector('#panels [visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]')?.removeAttribute('visibility');
      document.querySelector('#primary').closest('[is-two-columns_]').setAttribute('fixed-panels', '');
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      return true;
    })()`);
    await stepAside('open-panel');

    await page.eval(`document.querySelector('[fixed-panels]').removeAttribute('fixed-panels')`);
    await reapply();
  });

  test('a live chat Steps Aside only while one is actually in the rail', async () => {
    // The measured state of a past stream whose chat replay was never opened: a
    // frame that is present, `collapsed`, `hide-chat-frame`, and drawn nowhere —
    // 0×0, `display: none`, with `#chat-container` holding nothing. It cost the
    // Comment Pane until this was read properly, and it must not.
    const idle = await page.eval(`(() => {
      const frame = document.createElement('ytd-live-chat-frame');
      frame.id = 'chat';
      frame.setAttribute('collapsed', '');
      frame.setAttribute('hide-chat-frame', '');
      frame.style.display = 'none';
      document.querySelector('#chat-container').append(frame);
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      const box = frame.getBoundingClientRect();
      const root = document.documentElement;
      return { box: [Math.round(box.width), Math.round(box.height)],
        applied: root.dataset.ysc ?? null, reason: root.dataset.yscReason ?? null,
        pane: !!document.querySelector('#ysc-pane #comments') };
    })()`);
    assert.deepEqual(idle.box, [0, 0], 'the frame under test is not the hidden one it is meant to be');
    assert.equal(idle.applied, 'on', 'a chat frame YouTube was not showing cost the Comment Pane');
    assert.equal(idle.reason, null, `the extension Stepped Aside over a chat nobody can see: ${idle.reason}`);
    assert.equal(idle.pane, true, 'the Comments are not in the Comment Pane');

    // The same frame shown and filling the rail: that is a chat in use, and the
    // Comment Pane gets out of its way exactly as it always has.
    await page.eval(`(() => {
      const frame = document.getElementById('chat');
      frame.removeAttribute('collapsed');
      frame.removeAttribute('hide-chat-frame');
      frame.style.display = 'flex';
      frame.style.height = '800px';
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      return true;
    })()`);
    await stepAside('live-chat');

    // And YouTube's own statement of it on the root, with no frame in the page
    // at all — which is the signal a live stream carries.
    await page.eval(`(() => {
      document.getElementById('chat').remove();
      document.querySelector('[is-two-columns_]').setAttribute('live-chat-present-and-expanded', '');
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      return true;
    })()`);
    await stepAside('live-chat');

    // Collapsing the chat is YouTube's own act, and nothing is dispatched here:
    // the flag is watched, so the Comment Pane comes back on the flag alone.
    await page.eval(
      `document.querySelector('[live-chat-present-and-expanded]')
        .removeAttribute('live-chat-present-and-expanded')`,
    );
    await page.waitFor(`document.documentElement.dataset.ysc === 'on'`, 'the Comment Pane to come back', 15_000);
    assert.equal(
      await page.eval(`!!document.querySelector('#ysc-pane #comments')`),
      true,
      'the Comments did not come back to the Comment Pane when the chat went away',
    );
  });

  test('a fullscreen document Steps Aside', async () => {
    // Fullscreen has no attribute to read, so this one is entered for real: a
    // click for the user activation the browser demands, then the request.
    const click = { x: 400, y: 300, button: 'left', clickCount: 1 };
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...click });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...click });
    await page.eval(`document.documentElement.requestFullscreen()`, { awaitPromise: true });
    await stepAside('fullscreen');

    await page.eval(`document.exitFullscreen()`, { awaitPromise: true });
    await page.waitFor(`document.documentElement.dataset.ysc === 'on'`, 'the layout to come back', 15_000);
  });

  // ---------------------------------------------------------------- Splitter

  /** Every number a width change moves, read fresh from the page. */
  const splitterGeometry = () => page.eval(`(() => {
    const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
      return { left: +b.left.toFixed(1), right: +b.right.toFixed(1), top: +b.top.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1) }; };
    const frame = document.querySelector('#movie_player');
    const video = frame?.querySelector('video');
    return {
      pane: box(document.querySelector('#ysc-pane')),
      frame: box(frame),
      video: box(video),
      // YouTube writes the Player's internal sizes as inline pixels, so this is
      // the number that goes stale when nothing tells it the width changed.
      inline: video ? parseFloat(video.style.width) : null,
      // The control bar is sized the same way, and goes stale the same way.
      bar: box(document.querySelector('#movie_player .ytp-chrome-bottom')),
      splitter: box(document.querySelector('#ysc-splitter')),
      // The box the ceiling is a fraction of, measured the way the Adapter does.
      container: document.querySelector('#primary').parentElement.clientWidth,
      // And what that box spends on neither column, measured the same way: the
      // gutter between the Player and the Pane, and the page's own margin.
      chrome: +(
        document.querySelector('#primary').parentElement.clientWidth -
        document.querySelector('#player').getBoundingClientRect().width -
        document.querySelector('#secondary-inner').clientWidth
      ).toFixed(1),
      applied: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ysc-pane-width')),
    };
  })()`);

  /**
   * A **real** drag, through CDP's pointer input rather than synthesized DOM
   * events, so capture, the document-level fallbacks, the drag lock and the
   * animation-frame debounce are all exercised the way a hand exercises them.
   * `delta` is how far the pointer travels left, which is how much wider the
   * Pane is asked to become.
   */
  const dragSplitter = async (delta, { steps = 8, during } = {}) => {
    const g = await splitterGeometry();
    const y = Math.round(g.pane.top + 80);
    const x = Math.round(g.splitter.left + g.splitter.width / 2);
    const at = (i) => Math.round(x - (delta * i) / steps);
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at(i), y, button: 'left', buttons: 1 });
      if (during && i === Math.ceil(steps / 2)) await during({ x: at(i), y });
    }
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at(steps), y, button: 'left', buttons: 0, clickCount: 1 });
    return g;
  };

  /** A real click, so the Splitter takes focus the way it would for a reader. */
  const clickSplitter = async (clickCount) => {
    const g = await splitterGeometry();
    const x = Math.round(g.splitter.left + g.splitter.width / 2);
    const y = Math.round(g.pane.top + 80);
    for (let i = 1; i <= clickCount; i++) {
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: i });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: i });
    }
  };

  const press = async (key, virtualKeyCode) => {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', {
        type, key, code: key, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode,
      });
    }
  };

  /** The resync is dispatched on an animation frame, so it lands after the input
   *  that caused it: waited for rather than assumed. */
  const waitForResync = () =>
    page.waitFor(`(() => {
      const f = document.querySelector('#movie_player'), v = f?.querySelector('video');
      return !!v && Math.abs(v.getBoundingClientRect().width - f.getBoundingClientRect().width) <= 1;
    })()`, 'the Player to resync its internals', 10_000);

  test('the Splitter is a separator between the Player and the Comment Pane', async () => {
    const r = await page.eval(`(() => {
      const h = document.querySelector('#ysc-splitter');
      const pane = document.querySelector('#ysc-pane');
      const b = h?.getBoundingClientRect();
      h?.focus();
      const centre = b.left + b.width / 2;
      return {
        inRail: !!document.querySelector('#secondary-inner > #ysc-splitter'),
        beforePane: !!(h.compareDocumentPosition(pane) & Node.DOCUMENT_POSITION_FOLLOWING),
        role: h.getAttribute('role'),
        orientation: h.getAttribute('aria-orientation'),
        label: h.getAttribute('aria-label'),
        focusable: h.tabIndex === 0,
        focused: document.activeElement === h,
        // The boundary the Splitter divides is the Comment Pane's own edge, so
        // that is where its box ends — and it begins clear of the Player, so the
        // whole of it lies in the gutter rather than over either column.
        separatorBetween:
          Math.abs(b.right - pane.getBoundingClientRect().left) <= 1 &&
          b.left >= document.querySelector('#player').getBoundingClientRect().right - 1,
        // Hit-testable exactly where it is drawn: a divider that no pointer
        // event can reach is a divider nobody can drag.
        hittable: document.elementFromPoint(centre, b.top + 20) === h,
        height: +b.height.toFixed(1),
        paneHeight: +pane.getBoundingClientRect().height.toFixed(1),
      };
    })()`);

    assert.equal(r.inRail, true, 'the Splitter is not in the rail beside the Comment Pane');
    assert.equal(r.beforePane, true, 'the Splitter does not come before the Comment Pane');
    assert.equal(r.role, 'separator', 'the Splitter is not exposed as a separator');
    assert.equal(r.orientation, 'vertical', 'the separator is not vertical');
    assert.ok(/Comment Pane/.test(r.label), `the Splitter is not labelled for what it does: ${r.label}`);
    assert.equal(r.focusable, true, 'the Splitter cannot take focus');
    assert.equal(r.focused, true, 'the Splitter did not take focus');
    assert.equal(r.separatorBetween, true, 'the Splitter is not between the Player and the Comment Pane');
    assert.equal(r.hittable, true, 'no pointer event can reach the Splitter where it is drawn');
    assert.ok(
      Math.abs(r.height - r.paneHeight) <= 1,
      `the Splitter is ${r.height}px tall beside a ${r.paneHeight}px Comment Pane`,
    );
  });

  /** What the Splitter is drawn on, what it is drawn as, and what a pointer
   *  finds on the Comments' own left edge. */
  const splitterChrome = () => page.eval(`(() => {
    const box = (e) => { const b = e.getBoundingClientRect();
      return { left: +b.left.toFixed(1), right: +b.right.toFixed(1), top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), width: +b.width.toFixed(1) }; };
    const splitter = document.getElementById('ysc-splitter');
    const comments = document.querySelector('#comments');
    const css = (e, p, ps) => getComputedStyle(e, ps).getPropertyValue(p);
    const s = box(splitter), c = box(comments);
    return {
      splitter: s, comments: c, player: box(document.querySelector('#player')),
      band: css(splitter, 'background-color'),
      mark: css(splitter, 'background-color', '::after'),
      markWidth: css(splitter, 'width', '::after'),
      cursor: css(splitter, 'cursor'),
      // What a reader's pointer finds one pixel inside the Comments' left edge:
      // the Splitter may not be the thing sitting on the first pixels of the
      // thread — on that row, or on any of the rows it could reach.
      atEdge: (() => { const e = document.elementFromPoint(c.left + 1, c.top + 40);
        return e ? (e.id || e.tagName.toLowerCase()) : null; })(),
      overComments: (() => {
        const last = Math.min(s.bottom, c.bottom) - 2;
        for (let y = Math.max(s.top, c.top) + 2; y < last; y += 32) {
          if (document.elementFromPoint(c.left + 1, y) === splitter) return y;
        }
        return null;
      })(),
    };
  })()`);

  test('the Splitter covers no part of the Comments', async () => {
    const r = await splitterChrome();
    assert.ok(r.splitter && r.comments, 'the Splitter or the Comments is missing');
    // Measured against the Comments' own box, which is the Pane's whole width:
    // the Splitter ends where the Comments begin.
    assert.ok(
      r.splitter.right <= r.comments.left + 0.5,
      `the Splitter reaches ${r.splitter.right}, ${(r.splitter.right - r.comments.left).toFixed(1)}px into the Comments at ${r.comments.left}`,
    );
    // And it is in the gutter rather than over the Player either — the whole
    // width of it is space neither column was using.
    assert.ok(
      r.splitter.left >= r.player.right - 0.5,
      `the Splitter starts at ${r.splitter.left}, inside the Player which ends at ${r.player.right}`,
    );
    assert.equal(r.overComments, null, 'the Splitter is the element on top of the Comments');
    assert.notEqual(r.atEdge, 'ysc-splitter', 'the first pixel of the Comments belongs to the Splitter');
    assert.equal(r.cursor, 'col-resize', 'nothing on the boundary says it can be dragged');
  });

  test('the Splitter is invisible at rest and apparent when hovered or focused', async () => {
    // Whatever the test before this one left the pointer and the focus on.
    await page.eval(`document.activeElement?.blur()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 60, y: 400 });
    const rest = await splitterChrome();
    assert.deepEqual(
      [rest.band, rest.mark],
      ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'],
      'the Splitter is drawn on the boundary at rest',
    );

    // A real pointer, resting on it — and nowhere near the boundary at rest, so
    // what is measured is the Splitter's own hover state.
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(rest.splitter.left + rest.splitter.width / 2),
      y: Math.round(rest.splitter.top + 200),
    });
    const hovered = await splitterChrome();
    // A hairline rather than a block, and thin enough to read as the seam
    // between the Player and the Pane rather than as chrome stood on it.
    assert.equal(hovered.markWidth, '2px', 'the Splitter did not show a hairline on hover');
    assert.notEqual(hovered.mark, 'rgba(0, 0, 0, 0)', 'hovering the Splitter shows nothing');

    // The reader's own way there: tab backwards out of the Comments, which is
    // what comes before the Splitter in the page's own order. Focus a reader
    // arrives at this way is keyboard focus by definition, where a script
    // `focus()` is not — the Splitter has no pointer resting on the boundary to
    // say where they are.
    await page.eval(`document.getElementById('ysc-pane')
      .querySelector('a[href], button, input, textarea, [tabindex]:not([tabindex="-1"])')?.focus()`);
    const tab = { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 };
    await page.send('Input.dispatchKeyEvent', tab);
    await page.send('Input.dispatchKeyEvent', { ...tab, type: 'keyUp' });
    const focused = await page.eval(`(() => {
      const s = document.getElementById('ysc-splitter');
      const css = (p, ps) => getComputedStyle(s, ps).getPropertyValue(p);
      return { active: document.activeElement?.id ?? null, visible: s.matches(':focus-visible'),
        mark: css('background-color', '::after'), band: css('background-color') };
    })()`);
    assert.equal(focused.active, 'ysc-splitter', 'Shift+Tab out of the Comments did not reach the Splitter');
    assert.equal(focused.visible, true, 'the Splitter has no keyboard focus state of its own');
    assert.notEqual(focused.band, 'rgba(0, 0, 0, 0)', 'focusing the Splitter leaves it invisible');
    assert.notEqual(focused.mark, hovered.mark, 'focusing the Splitter looks the same as hovering it');
  });

  /** The Pane's top, the Splitter's top and the Player's, at one scroll offset,
   *  read in one frame: what the page scrolled under is the Player's number. */
  const atScroll = async (y) => {
    await page.eval(`window.scrollTo(0, ${y})`);
    await sleep(200);
    return page.eval(`(() => {
      const t = (s) => { const e = document.querySelector(s); return e ? +e.getBoundingClientRect().top.toFixed(1) : null; };
      const pane = document.querySelector('#ysc-pane');
      return { y: Math.round(window.scrollY), player: t('#player'), pane: t('#ysc-pane'),
        splitter: t('#ysc-splitter'), paneHeight: +pane.getBoundingClientRect().height.toFixed(1),
        railBottom: +document.querySelector('#secondary-inner').getBoundingClientRect().bottom.toFixed(1),
        sticky: parseFloat(getComputedStyle(pane).top) || 0 };
    })()`);
  };

  test('the Pane is pinned while the page scrolls under it, and the Splitter stays with it', async () => {
    const rest = await atScroll(0);
    // How far the Pane can be pinned at all: until its own bottom reaches the
    // end of the rail it is pinned inside, which is where the Recommendation
    // Strip begins. That is the description's own height, so a page with a
    // longer one pins the Pane for longer.
    const travel = Math.round(rest.railBottom - rest.sticky - rest.paneHeight);
    assert.ok(travel > 100, `the rail gives the Pane only ${travel}px to be pinned in`);

    const down = await atScroll(Math.min(200, travel - 20));
    // The page moved under it — the Player went down by exactly what was
    // scrolled — and the Pane did not: it is held at its sticky top rather than
    // travelling with the page, which is what it did before this was fixed.
    assert.ok(
      Math.abs(down.player - (rest.player - down.y)) <= 1,
      `the page did not scroll: the Player is at ${down.player} for a scroll of ${down.y}`,
    );
    assert.equal(down.pane, down.sticky, `the Pane was at ${down.pane} rather than held at ${down.sticky}`);
    assert.ok(down.splitter === down.pane, `the Splitter is at ${down.splitter}, the Pane at ${down.pane}`);

    // Past the end of the rail both travel with the page, together — the Splitter
    // is pinned by the rail's own arithmetic, not by a rule of its own.
    const past = await atScroll(travel + 400);
    assert.ok(past.pane < past.sticky, 'the Pane is still pinned past the end of the rail it is pinned in');
    assert.ok(past.splitter === past.pane, `the Splitter is at ${past.splitter}, the Pane at ${past.pane}`);
    // Scrolling back leaves the Pane exactly where it started, so nothing of
    // the pinning is left behind in the page's own layout.
    const back = await atScroll(0);
    assert.ok(Math.abs(back.pane - rest.pane) <= 1, `the Pane came back to ${back.pane}, not ${rest.pane}`);
    assert.ok(back.splitter === back.pane, 'the Splitter came back somewhere else than the Pane');
  });

  test('a drag is the page reflowing, not the Splitter working', async () => {
    // The same twelve width changes a drag writes, alone and then with the
    // page's own layout forced after each: the first is what the Splitter
    // spends, the second is what the page spends answering a width that
    // changed. Twelve writes are what the drag passes through in a gesture.
    const r = await page.eval(`(() => {
      const root = document.documentElement;
      const was = root.style.getPropertyValue('--ysc-pane-width');
      const at = (i) => (402 + i * 10) + 'px';
      let t = performance.now();
      for (let i = 0; i < 12; i++) root.style.setProperty('--ysc-pane-width', at(i));
      const writes = performance.now() - t;
      t = performance.now();
      for (let i = 0; i < 12; i++) { root.style.setProperty('--ysc-pane-width', at(i)); void root.offsetWidth; }
      const relayout = performance.now() - t;
      // The width the page had, put back: this measures the cost, it does not
      // choose a width.
      root.style.setProperty('--ysc-pane-width', was);
      void root.offsetWidth;
      return { writes: +writes.toFixed(2), relayout: +relayout.toFixed(2) };
    })()`);
    assert.ok(
      r.writes * 10 < r.relayout,
      `twelve width changes cost the Splitter ${r.writes}ms and the page's own relayout ${r.relayout}ms` +
        ' — the Splitter is paying for something that is not its work',
    );
  });

  test('dragging the Splitter resizes the Comment Pane and the Player keeps up', async () => {
    const before = await splitterGeometry();
    const delta = 240;
    let mid;
    await dragSplitter(delta, {
      during: async ({ x, y }) => {
        mid = await page.eval(`(() => {
          const under = document.elementFromPoint(${x}, ${y});
          return {
            locked: document.documentElement.hasAttribute('data-ysc-drag'),
            cursor: under ? getComputedStyle(under).cursor : null,
            selected: String(getSelection()).length,
            applied: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ysc-pane-width')),
          };
        })()`);
      },
    });
    await waitForResync();
    const after = await splitterGeometry();

    // The Pane followed the pointer, and the width came out of the Player.
    assert.ok(
      Math.abs(after.applied - (before.applied + delta)) <= 1,
      `a ${delta}px drag left the Comment Pane at ${after.applied}px, not ${before.applied + delta}px`,
    );
    assert.ok(
      Math.abs(after.frame.width - (before.frame.width - delta)) <= 1,
      `the Player is ${after.frame.width}px wide after losing ${delta}px, not ${before.frame.width - delta}px`,
    );

    // The Player's internals followed its frame. The inline width is the one
    // that goes stale: it started at the old frame width, so a Player left
    // unresynced would still be holding it.
    assert.ok(
      after.frame.width !== before.frame.width,
      'the drag did not change the Player frame, so nothing was measured',
    );
    assert.ok(
      Math.abs(after.inline - after.frame.width) <= 2,
      `the <video> is ${after.inline}px inside a ${after.frame.width}px frame — the Player kept a stale width`,
    );
    assert.ok(
      after.video.width - after.frame.width <= 1,
      `the <video> overflows its Player frame by ${(after.video.width - after.frame.width).toFixed(1)}px`,
    );
    assert.ok(
      after.bar === null || after.bar.width - after.frame.width <= 1,
      `the control bar overflows its Player frame by ${(after.bar.width - after.frame.width).toFixed(1)}px`,
    );

    // The Pane was already halfway there when the pointer was halfway there:
    // it follows the drag rather than jumping to where the gesture ended.
    assert.ok(
      Math.abs(mid.applied - (before.applied + delta / 2)) <= 2,
      `the Pane was ${mid.applied}px wide with the pointer halfway, not ${before.applied + delta / 2}px`,
    );
    // And the gesture itself was a deliberate one, not a page-wide text sweep.
    assert.equal(mid.locked, true, 'the drag did not lock the page against text selection');
    assert.equal(mid.selected, 0, 'dragging the Splitter selected page text');
    assert.equal(mid.cursor, 'col-resize', `the cursor during the drag was ${mid.cursor}`);
  });

  test('the Comment Pane stops at its floor and its ceiling', async () => {
    const start = await splitterGeometry();
    // Past the ceiling: the pointer goes to the window's left edge.
    await dragSplitter(start.pane.left);
    await waitForResync();
    const wide = await splitterGeometry();
    const ceiling = Math.min(start.container * 0.6, start.container - start.chrome - 480);
    assert.ok(
      Math.abs(wide.applied - ceiling) <= 1,
      `the Pane stopped at ${wide.applied}px, not the ${ceiling}px ceiling`,
    );
    assert.ok(
      wide.frame.width >= 480,
      `the ceiling left the Player ${wide.frame.width}px wide, inside the band never measured`,
    );
    // YouTube's own floor on that column is ~853px. Reaching the ceiling at all
    // means the drag walked straight through it — which it only can because the
    // Adapter overrides `min-width` down the Player's whole chain of ancestors.
    assert.ok(
      wide.frame.width < 853,
      `the drag stopped at ${wide.frame.width}px, at YouTube's own column floor rather than the ceiling`,
    );

    // And past the floor, without leaving the window.
    await dragSplitter(-1000);
    await waitForResync();
    const narrow = await splitterGeometry();
    assert.equal(narrow.applied, 320, `the Pane shrank to ${narrow.applied}px, past its 320px floor`);
    assert.ok(narrow.frame.width > 300, `the Player was squeezed to ${narrow.frame.width}px`);
    assert.ok(
      Math.abs(narrow.inline - narrow.frame.width) <= 2,
      'the Player kept a stale width after the Pane hit its floor',
    );

    await clickSplitter(2); // leave the Pane at its default for what follows
    await waitForResync();
  });

  test('where the container − Player term sets the ceiling, the Player keeps its measured width', async () => {
    // A window narrow enough that the term, and not 60% of the container, is
    // the smaller one — which on the 1889px container above it is not, so this
    // is the only place the two can be told apart. The Strip's own box is what
    // says the page has laid itself out again.
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: NARROW_VIEWPORT, height: 1080, deviceScaleFactor: 1, mobile: false,
    });
    await page.waitFor(
      `(() => { const s = document.getElementById('ysc-strip'); return !!s && s.getBoundingClientRect().width < ${NARROW_STRIP}; })()`,
      'a container the second term binds in',
      15_000,
    );
    await sleep(500);
    const before = await splitterGeometry();
    // Short of the window's edge, so the pointer stays inside it: the request is
    // already far past the ceiling either way.
    await dragSplitter(Math.round(before.pane.left) - 20);
    await waitForResync();
    const at = await splitterGeometry();
    assert.ok(
      at.applied < before.container * 0.6,
      `60% of the ${before.container}px container was the smaller term after all, at ${at.applied}px`,
    );
    // The whole point of the term: the Player's column, chrome and all, is what
    // is held at the width it was measured safe at — not the container, which
    // would have left it the 48px the page spends around the columns short.
    assert.ok(
      Math.abs(at.frame.width - 480) <= 1,
      `the ceiling left the Player ${at.frame.width}px, not the measured-safe 480px`,
    );

    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.waitFor(
      `(() => { const s = document.getElementById('ysc-strip'); return !!s && s.getBoundingClientRect().width > ${NARROW_STRIP}; })()`,
      'the window it had',
      15_000,
    );
    await clickSplitter(2);
    await waitForResync();
    assert.equal((await splitterGeometry()).applied, 402, 'the width did not come back to the default with the window');
  });

  test('the arrow keys move the Splitter, and double-click puts it back', async () => {
    await clickSplitter(1);
    const focused = await page.eval(`document.activeElement?.id ?? null`);
    assert.equal(focused, 'ysc-splitter', 'clicking the Splitter did not focus it');

    const before = await splitterGeometry();
    await press('ArrowLeft', 37);
    await press('ArrowLeft', 37);
    assert.equal(
      (await splitterGeometry()).applied,
      before.applied + 2 * KEYBOARD_STEP,
      'the arrow keys did not move the Splitter by the same amount as each other',
    );
    await press('ArrowRight', 39);
    assert.equal(
      (await splitterGeometry()).applied,
      before.applied + KEYBOARD_STEP,
      'the right arrow did not undo one left arrow',
    );

    await clickSplitter(2);
    assert.equal(
      (await splitterGeometry()).applied,
      402,
      'double-clicking the Splitter did not restore the default width',
    );
  });

  test('a burst of width changes costs one Player resync per frame, not one each', async () => {
    await clickSplitter(1);
    await page.eval(`(() => {
      window.__resizes = 0; window.__frames = 0;
      addEventListener('resize', () => { window.__resizes++; });
      const tick = () => { window.__frames++; window.__frame = requestAnimationFrame(tick); };
      window.__frame = requestAnimationFrame(tick);
    })()`);

    // Key events are discrete — Chrome coalesces pointer moves but never these —
    // so eight presses sent together are eight width changes inside one frame.
    // Undebounced, each would be a full Player relayout in that same frame.
    await Promise.all(Array.from({ length: 8 }, () => press('ArrowLeft', 37)));
    // The frame count stops with the burst, so the frames that pass while the
    // Pane is left alone cannot flatter the comparison.
    await page.eval(`cancelAnimationFrame(window.__frame)`);
    await sleep(300);

    const r = await page.eval(`({ resizes: window.__resizes, frames: window.__frames })`);
    assert.ok(r.resizes > 0, 'no resize was dispatched for eight width changes');
    assert.ok(
      r.resizes <= r.frames + 1,
      `${r.resizes} Player resyncs for eight width changes in ${r.frames} frames — not debounced`,
    );
  });

  /** Last of the Splitter's tests, and the reason it goes last: it loads another
   *  page, so everything after it starts from a fresh document. */
  test('the width is one global preference, not a fact about one video', async () => {
    await dragSplitter(160);
    await waitForResync();
    const chosen = (await splitterGeometry()).applied;
    assert.ok(chosen > 402, 'the drag did not change the width, so nothing was persisted');
    await sleep(500); // the commit is a storage write, not a repaint

    // A different video, loaded as a new document: the content script starts
    // over and has nothing but the stored preference to go on. The marker is
    // what proves the document in front of us is the new one — waiting on the
    // Pane alone would pass on the page being replaced.
    await page.eval(`window.__before = true`);
    await page.send('Page.navigate', { url: OTHER_URL });
    await page.waitFor(`window.__before === undefined`, 'the next video to load', 60_000);
    await page.waitFor(
      `!!document.querySelector('#ysc-pane ytd-comment-thread-renderer')`,
      'the Comment Pane on the next video',
      90_000,
    );
    const restored = await page.eval(
      `parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ysc-pane-width'))`,
    );
    assert.ok(
      Math.abs(restored - chosen) <= 1,
      `the next video opened with a ${restored}px Pane, not the ${chosen}px it was left at`,
    );
  });

  // ---------------------------------------------------------------- Navigation

  /**
   * Our own arrangement, observed as it changes rather than inferred from the
   * code: the transitions of `[Comment Pane present, layout attribute]`, plus a
   * count of YouTube's own navigation events. The pair is what tells a teardown
   * of ours from a pane YouTube removed for us — a pane YouTube destroyed
   * leaves the layout attribute standing, so `[false, null]` can only be the
   * extension having put the page back to the Native Layout.
   */
  const RECORD_NAVIGATION = `
    window.__ysc = [];
    window.__nav = { start: 0, finish: 0 };
    addEventListener('yt-navigate-start', () => { window.__nav.start++; });
    addEventListener('yt-navigate-finish', () => { window.__nav.finish++; });
    const snap = () => {
      const s = [!!document.getElementById('ysc-pane'), document.documentElement.dataset.ysc || null];
      const was = window.__ysc[window.__ysc.length - 1];
      if (!was || was[0] !== s[0] || was[1] !== s[1]) window.__ysc.push(s);
    };
    new MutationObserver(snap).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-ysc'] });
    window.__forget = () => { window.__ysc = []; window.__nav = { start: 0, finish: 0 }; };
    true;
  `;

  /** Everything an arrival has to be true of, read in one go. */
  const arrangement = (p = page) => p.eval(`(() => { ${PRELUDE}
    const pane = document.getElementById('ysc-pane');
    const strip = document.getElementById('ysc-strip');
    const comments = document.querySelector('#comments');
    const related = document.querySelector('#related');
    const root = document.documentElement;
    const box = (e) => { const b = e && e.getBoundingClientRect(); return b ? {
      left: +b.left.toFixed(1), right: +b.right.toFixed(1), top: +b.top.toFixed(1),
      bottom: +b.bottom.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1) } : null; };
    const ours = (e) => (e.id || '').includes('ysc') || [...e.attributes].some((a) => a.name.includes('ysc'));
    const rendered = [...(pane ? pane.querySelectorAll('ytd-comment-thread-renderer') : [])]
      .find((t) => t.getBoundingClientRect().height > 0);
    return {
      video: new URL(location.href).searchParams.get('v'),
      applied: root.dataset.ysc || null,
      reason: root.dataset.yscReason || null,
      width: +parseFloat(getComputedStyle(root).getPropertyValue('--ysc-pane-width')) || 0,
      pane: box(pane), strip: box(strip), player: box(document.querySelector('#player')),
      inRail: !!document.querySelector('#secondary-inner > #ysc-pane'),
      holdsComments: !!pane && pane.contains(comments),
      threads: pane ? pane.querySelectorAll('ytd-comment-thread-renderer').length : 0,
      splitter: !!document.querySelector('#secondary-inner > #ysc-splitter'),
      stripHoldsRelated: !!strip && strip.contains(related),
      // Any related list that is *not* in the Strip is a second one: YouTube can
      // hand the page a fresh element rather than refilling the one we moved,
      // and what we are holding is then the previous video's list. (YouTube's
      // own zero-size skeleton placeholder also carries the id, which is why
      // this counts the lists outside the Strip rather than the lists at all.)
      relatedOutsideStrip: [...document.querySelectorAll('#related')].filter((e) => !strip?.contains(e)).length,
      scrollTop: pane ? Math.round(pane.scrollTop) : null,
      scrollY: Math.round(window.scrollY),
      // The first thread that has a box. YouTube leaves zero-size placeholder
      // renderers among the Comments, and the first one in document order can be
      // one of those rather than a comment anybody can read.
      firstThread: box(rendered),
      firstOnScreen: onScreen(rendered, pane),
      overflow: root.scrollWidth - root.clientWidth,
      // Only so an overflow failure names the element rather than the number.
      offenders: [...document.querySelectorAll('body *')]
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.right > root.clientWidth + 0.5)
        .sort((a, b) => b.r.right - a.r.right).slice(0, 3)
        .map(({ e, r }) => sig(e) + ' ' + Math.round(r.left) + '-' + Math.round(r.right) + ' in ' + sig(e.parentElement)),
      // The boxes the offender list above cannot see, which is where a
      // sideways scroll measured with nothing named has to be coming from: the
      // root and the body themselves, and the width the page is laid out
      // against. Read in the same frame as the number they explain.
      widths: {
        inner: innerWidth, client: root.clientWidth, scroll: root.scrollWidth,
        root: box(root)?.width ?? null, body: box(document.body)?.width ?? null,
        columns: box(document.querySelector('#columns'))?.width ?? null,
        rail: box(document.querySelector('#secondary'))?.width ?? null,
      },
      // The chain the Comments sit at, so a drift in nesting depth or in the
      // container they were moved into cannot pass unnoticed.
      chain: chain(comments && comments.parentElement).join('<'),
      // One of each, and only ever one: anything that accumulates as the layout
      // is torn down and re-applied shows up here as a second copy.
      counts: {
        pane: document.querySelectorAll('#ysc-pane').length,
        strip: document.querySelectorAll('#ysc-strip').length,
        splitter: document.querySelectorAll('#ysc-splitter').length,
        comments: document.querySelectorAll('#comments').length,
        ours: [...document.querySelectorAll('body *')].filter(ours).length,
      },
      // Where each copy of the related list is, for the diagnosis a failure
      // needs: which one is ours, and which one YouTube is offering now.
      relateds: [...document.querySelectorAll('#related')].map((e) => {
        const b = e.getBoundingClientRect();
        return {
          inStrip: !!strip && strip.contains(e),
          chain: chain(e.parentElement).join('<'),
          cards: e.querySelectorAll('${CARD}').length,
          box: Math.round(b.width) + 'x' + Math.round(b.height),
          display: getComputedStyle(e).display,
        };
      }),
      timeline: window.__ysc || null,
      nav: window.__nav || null,
    };
  })()`);

  /** Every arrival, wherever it came from, has to be arranged the same way. */
  const assertArranged = (r, why) => {
    const at = `${why} — ${JSON.stringify({
      video: r.video, reason: r.reason, counts: r.counts, chain: r.chain, relateds: r.relateds,
      scrollTop: r.scrollTop, scrollY: r.scrollY, firstThread: r.firstThread, widths: r.widths,
    })}`;
    assert.equal(r.applied, 'on', `the layout is not applied (${at})`);
    assert.equal(r.reason, null, `the extension Stepped Aside (${at})`);
    assert.equal(r.inRail, true, `the Comment Pane is not hosted in the rail (${at})`);
    assert.equal(r.holdsComments, true, `the Comment Pane does not hold the Comments (${at})`);
    assert.equal(r.splitter, true, `the Splitter is missing (${at})`);
    assert.equal(r.stripHoldsRelated, true, `the related videos are not in the Recommendation Strip (${at})`);
    assert.ok(r.strip && r.strip.top >= r.player.bottom - 1, `the Strip is not below the Player (${at})`);
    assert.ok(
      r.pane.width >= 320 && r.pane.left >= r.player.right - 1,
      `the Comment Pane is not beside the Player (${at})`,
    );
    assert.equal(r.relatedOutsideStrip, 0, `the related videos are somewhere other than the Strip (${at})`);
    // Eleven of ours on an arranged page: the three containers — the Comment
    // Pane, the Recommendation Strip and the Splitter — and the status control,
    // which is a wrapper holding a button and the panel that button opens, with
    // five lines inside that panel. The control sits inside YouTube's own
    // comments header, so it is taken out by hand when the layout is undone;
    // what this number catches is anything that *accumulates* as the layout is
    // torn down and re-applied. The residue count in `stepAside` above is the
    // stricter of the two: it counts everything of ours at any depth, and
    // requires none.
    assert.deepEqual(
      r.counts,
      { pane: 1, strip: 1, splitter: 1, comments: 1, ours: 11 },
      `the page accumulated residue (${at})`,
    );
    assert.equal(r.overflow, 0, `the page scrolls sideways by ${r.overflow}px (${at}) — ${JSON.stringify(r.offenders)}`);
  };

  /** The one thing no screenshot can show: the page was back in the Native
   *  Layout *before* the new arrangement landed on it, and it got there by
   *  navigation rather than by a fresh document — which is what the navigation
   *  record still being there, and YouTube's page-ready event having fired,
   *  together say. The counts are not pinned to the number of steps: YouTube
   *  starts and finishes navigations on its own bookkeeping, and does not always
   *  finish the ones it starts. */
  const assertTornDownFirst = (r, why) => {
    assert.ok(
      r.nav && r.nav.finish >= 1,
      `${why}: ${JSON.stringify(r.nav)} — the layout did not survive a navigation`,
    );
    assert.deepEqual(r.timeline.at(-1), [true, 'on'], `${why}: the new page never got the layout`);
    assert.deepEqual(
      r.timeline.at(-2),
      [false, null],
      `${why}: the previous arrangement was not fully undone first — ${JSON.stringify(r.timeline)}`,
    );
  };

  /** A real click, through CDP's pointer input, on a spot a page-side read has
   *  already brought into view. YouTube's own links are what a reader clicks,
   *  and a synthetic `.click()` on one is measured to be routed *sometimes* — a
   *  click that silently does nothing turns a navigation into a minute of
   *  waiting for one. */
  const mouseClick = async (spot) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page.send('Input.dispatchMouseEvent', {
        type, x: spot.x, y: spot.y, button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1,
      });
    }
    return spot;
  };

  /** A link, clicked where it is drawn — or clicked directly when YouTube has
   *  nothing drawn for it, which happens: the tab strip carries a second, hidden
   *  copy of the same link, and no pointer can be put into the middle of an
   *  element with no box. */
  const clickSelector = async (selector) => {
    const spot = await page.eval(`(() => {
      const link = document.querySelector(${JSON.stringify(selector)});
      if (!link) return null;
      // What a reader clicks is whatever is drawn: YouTube ships links with no
      // box of their own, so the point comes from the nearest ancestor that has
      // one.
      let drawn = link;
      for (let n = link; n && n !== document.body; n = n.parentElement) {
        const b = n.getBoundingClientRect();
        if (b.width > 2 && b.height > 2) { drawn = n; break; }
      }
      drawn.scrollIntoView({ block: 'center', behavior: 'instant' });
      const b = drawn.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), href: link.href };
    })()`);
    if (!spot) return null;
    await mouseClick(spot);
    return spot;
  };

  /**
   * A click on a video YouTube is offering: a related video on a Watch Page, or
   * one of the videos on the page the test navigated away to. YouTube's router
   * does the navigating — the test only clicks one of YouTube's own links, which
   * is measured to be the difference between a navigation and a document load.
   * An anchor the test makes itself is not routed, however it is placed.
   *
   * Cards that have not rendered, that are a mix or a playlist, and that are a
   * live stream or a Short are passed over: the last two Step Aside, correctly,
   * for reasons that have nothing to do with navigation. `skip` takes the next
   * one along, for a landing this test cannot say anything about.
   */
  const cardSpot = (skip = 0) =>
    page.eval(`(() => {
      const here = new URL(location.href).searchParams.get('v');
      const seen = new Set();
      const cards = [...document.querySelectorAll('a[href^="/watch"]')].filter((a) => {
        const card = a.closest('ytd-compact-video-renderer, yt-lockup-view-model, ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer');
        const text = card ? card.innerText.trim() : '';
        const id = new URL(a.href).searchParams.get('v');
        // One per video: a card carries an anchor on its thumbnail and another
        // on its title, so counting both would spend half the attempts on the
        // same video twice.
        if (!id || id === here || seen.has(id) || text.length <= 10) return false;
        // A live stream or a Short, by YouTube's own marker on the thumbnail
        // rather than by what the card happens to say: the badge is the thing
        // that is always there, and the word is not.
        if (card.querySelector('[overlay-style="LIVE"], [overlay-style="SHORTS"]')) return false;
        if (/\\b(live|shorts|premiere|upcoming)\\b/i.test(text)) return false;
        seen.add(id);
        return true;
      });
      // The first card from here that can actually be clicked: the card is what
      // is drawn and pressed — its link has no box of its own — and a card in a
      // horizontal shelf can sit half outside the window, where a point taken
      // from its middle falls on something else entirely.
      for (let i = ${skip}; i < cards.length; i++) {
        const card = cards[i].closest('ytd-compact-video-renderer, yt-lockup-view-model, ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer');
        if (!card) continue;
        card.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const b = card.getBoundingClientRect();
        const x = Math.round(b.left + b.width / 2), y = Math.round(b.top + b.height / 2);
        if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
        return {
          x, y, href: cards[i].href,
          text: card.innerText.replace(/\\s+/g, ' ').trim().slice(0, 50),
        };
      }
      return null;
    })()`);

  /** How a hop has landed: arranged on the video it arrived at, or on one this
   *  test has nothing to say about — a live stream, a Short, or a video whose
   *  comments YouTube has turned off. All three are facts about the page rather
   *  than signs of one still being built, so none of them is worth waiting on. */
  const landed = (from) => `(() => {
    const pane = document.getElementById('ysc-pane');
    const region = document.querySelector('#comments');
    const threads = [...(pane ? pane.querySelectorAll('ytd-comment-thread-renderer') : [])];
    if (new URL(location.href).searchParams.get('v') === ${JSON.stringify(from)}) return false;
    if (document.documentElement.dataset.ysc === 'on' && !!pane && pane.contains(region) &&
        threads.some((t) => t.getBoundingClientRect().height > 0)) return 'arranged';
    const reason = document.documentElement.dataset.yscReason;
    if (reason === 'live-chat' || reason === 'shorts') return 'aside';
    if (region && /comments are (turned off|disabled)/i.test(region.innerText)) return 'aside';
    return false;
  })()`;

  /**
   * Puts the page on a video this test knows is a plain one, by loading it
   * afresh — the fixture, not a step under test, and only ever at the start of
   * one: a document load wipes the page, so anything about what accumulates
   * across navigations has to be measured between hops that are all in-page.
   *
   * It is needed because the videos YouTube offers are not all usable ones:
   * this environment's recommendations drift into children's content, whose
   * comments YouTube has turned off, and a video whose comments are off Steps
   * Aside — correctly — which leaves nothing to navigate *from*.
   */
  const startFromKnownVideo = async () => {
    await page.send('Page.navigate', { url: WATCH_URL });
    await page.waitFor(
      `!!document.querySelector('#ysc-pane ytd-comment-thread-renderer')`,
      'the known video to load',
      90_000,
    );
    await page.eval(RECORD_NAVIGATION);
  };

  /** The Comment Pane scrolled down, so that arriving at the top of a new one is
   *  a fact rather than a default. Waited for, because the Comments are
   *  YouTube's: a Pane that has not filled yet is a Pane with nothing to scroll. */
  const scrollPaneDown = () =>
    poll(`(() => {
      const pane = document.getElementById('ysc-pane');
      if (!pane) return false;
      pane.scrollTop = 400;
      return pane.scrollTop > 0;
    })()`, 20_000);

  /** The first truthy value `expression` takes within `ms`, or `false`. Asked of
   *  `p`, which is the page in front unless the test is about another one: the
   *  page being waited on is often not the page on screen. */
  const poll = async (expression, ms, p = page) => {
    for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
      const value = await p.eval(expression).catch(() => false);
      if (value) return value;
      await sleep(300);
    }
    return false;
  };

  /** One click, waited out as an arrival, or `null` for a landing this test has
   *  nothing to say about — returned with what the page was, for the failure
   *  that gives up. */
  const clickAndWait = async (skip) => {
    const from = await page.eval(`new URL(location.href).searchParams.get('v')`);
    const here = await page.eval(`location.href`);
    const spot = await cardSpot(skip);
    assert.ok(spot, 'no video to navigate to on the page');
    await mouseClick(spot);
    // A click has to move the page before an arrival is worth reading: a card
    // for the video already on screen navigates nowhere, and reading the page it
    // did not leave would report a video the test never went to.
    if (!(await poll(`location.href !== ${JSON.stringify(here)}`, 10_000))) {
      return { unusable: { href: here, why: 'that card navigated nowhere' } };
    }
    if ((await poll(landed(from), 25_000)) === 'arranged') return { arrived: await arrangement() };
    return {
      unusable: await page.eval(`({
        href: location.href, reason: document.documentElement.dataset.yscReason || null,
        applied: document.documentElement.dataset.ysc || null,
        pane: !!document.getElementById('ysc-pane'),
        threads: document.querySelectorAll('#ysc-pane ytd-comment-thread-renderer').length,
        region: (document.querySelector('#comments')?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 50),
      })`).catch(() => null),
    };
  };

  /** A video from the rail of the known video — the reader's own gesture of
   *  clicking a related video, with each attempt starting from the known video
   *  again: a landing this test cannot use is a page whose own recommendations
   *  are the same kind of thing, so walking down its list would only find more
   *  of them. That reload is the fixture being reset between attempts, and it is
   *  never used between the hops an accumulation is claimed across. */
  const hopFromRail = async () => {
    let last = null;
    for (let skip = 0; skip < 5; skip++) {
      await startFromKnownVideo();
      await page.eval(`window.__forget()`);
      const { arrived, unusable } = await clickAndWait(skip);
      if (arrived) return arrived;
      last = unusable;
    }
    throw new Error(`the rail offered nothing this test could use — the last landing was ${JSON.stringify(last)}`);
  };

  /** A video from the page the Watch Page's channel lives on. Nothing is
   *  reloaded between attempts: a channel's own page offers its own videos, so a
   *  landing this test cannot use is the exception rather than the rule — and a
   *  page of YouTube's own recommendations, which is what the home feed is, is a
   *  list that in this environment runs into children's videos whose comments
   *  YouTube has turned off. */
  const hopFromChannel = async () => {
    const landings = [];
    for (let skip = 0; skip < 8; skip++) {
      const { arrived, unusable } = await clickAndWait(skip);
      if (arrived) return arrived;
      landings.push(unusable);
    }
    // Every landing, not only the last: a list of them is what tells a channel
    // of commentless videos — this environment's own drift — from a page this
    // extension failed to arrange.
    throw new Error(`the channel offered nothing this test could use — ${JSON.stringify(landings)}`);
  };

  /** Away to the channel the video belongs to, by clicking the channel link
   *  under it, waited out as an arrival: the page itself, with nothing of ours
   *  left on it. Waiting only for our own container to go would be satisfied by
   *  the teardown, which happens on the way out rather than on the way in.
   *
   *  Then the extension is asked to speak for the page, because YouTube does not
   *  always finish what it starts: measured, a navigation now and then fires
   *  `yt-navigate-start` and never `yt-navigate-finish`, and a page that never
   *  announces itself is one the extension never decides about — right to leave
   *  alone, but silent about why. The navigation is the test's and is asserted
   *  above; asking for the reason only makes it a fact rather than a race. */
  const toChannel = async () => {
    // Waited for first: the metadata is YouTube's to render, and a Watch Page
    // that has its Comments can still be a moment away from its channel link.
    const linked = await poll(`!!document.querySelector('#owner a, ytd-video-owner-renderer a')`, 20_000);
    assert.ok(
      linked,
      `no link off the Watch Page to navigate by — ${await page.eval(`JSON.stringify({
        href: location.href,
        owner: !!document.querySelector('#owner'),
        meta: !!document.querySelector('ytd-watch-metadata'),
        applied: document.documentElement.dataset.ysc || null,
      })`).catch(() => null)}`,
    );
    const { href: left } = (await clickSelector('#owner a, ytd-video-owner-renderer a')) ?? {};
    const arrived = await poll(
      `location.pathname !== '/watch' && !!document.querySelector('ytd-browse, ytd-rich-grid-renderer') &&
        !document.getElementById('ysc-pane') && !document.documentElement.dataset.ysc`,
      60_000,
    );
    assert.ok(
      arrived,
      `the Watch Page was never left — ${await page.eval(`JSON.stringify({
        href: location.href, applied: document.documentElement.dataset.ysc || null,
        reason: document.documentElement.dataset.yscReason || null,
        pane: !!document.getElementById('ysc-pane'), nav: window.__nav || null,
      })`).catch(() => null)}`,
    );
    // Read before asking, so that what YouTube itself fired is what is counted.
    const nav = await page.eval(`window.__nav || null`);
    await page.eval(`dispatchEvent(new CustomEvent('yt-navigate-finish'))`);
    return { left, nav };
  };

  /** A round trip: away to the channel the video belongs to — a page this
   *  extension does nothing on — and back to a Watch Page that page offers. Two
   *  real in-page navigations, in both directions, each started by clicking
   *  something YouTube itself put there. */
  const roundTrip = async () => {
    await toChannel();
    return hopFromChannel();
  };

  test('navigating to another video lands arranged, without a refresh', async () => {
    await startFromKnownVideo();
    const before = await arrangement();
    assert.equal(before.applied, 'on', 'the layout was not applied to navigate from');

    // Read a thread that is about to stop existing: the Comment Pane that comes
    // back must not still be holding this position in it.
    assert.ok(await scrollPaneDown(), 'the Comment Pane never became scrollable, so nothing was measured');

    const after = await hopFromRail();

    assertArranged(after, 'arriving at another video');
    assertTornDownFirst(after, 'arriving at another video');
    assert.ok(after.threads > 0, 'the new video’s Comments did not load');
    assert.equal(after.scrollTop, 0, 'the Comment Pane kept the previous video’s scroll position');
    assert.equal(
      after.firstOnScreen,
      true,
      `the first comment thread is not visible in the Comment Pane — ${JSON.stringify({
        threads: after.threads, scrollTop: after.scrollTop, scrollY: after.scrollY,
        pane: after.pane, firstThread: after.firstThread,
      })}`,
    );
    assert.equal(after.width, before.width, 'the width preference did not survive the navigation');
    assert.equal(after.chain, before.chain, 'the Comments arrived at a different nesting depth');
  });

  test('navigating back and forth re-arranges every time, leaving no residue', async () => {
    await startFromKnownVideo();
    const opened = await arrangement();
    // Three round trips, six in-page navigations in all, in both directions.
    // Every arrival has to be the same arrangement as the first, which is what
    // "nothing accumulated" means — and each one is read from a thread that is
    // about to stop existing, so the Pane that comes back can never be holding
    // the previous video's position in it.
    for (let n = 1; n <= 3; n++) {
      await scrollPaneDown();
      await page.eval(`window.__forget()`);
      const r = await roundTrip();
      const why = `round trip ${n}, back on ${r.video}`;
      assertArranged(r, why);
      assertTornDownFirst(r, why);
      assert.ok(r.threads > 0, `${why}: the Comments did not load`);
      assert.equal(r.firstOnScreen, true, `${why}: the first comment thread is not visible`);
      assert.equal(r.scrollTop, 0, `${why}: the Comment Pane kept the previous video’s scroll position`);
      assert.equal(r.width, opened.width, `${why}: the width preference did not survive`);
      assert.equal(r.chain, opened.chain, `${why}: the Comments arrived at a different nesting depth`);
    }
  });

  test('navigating away from a Watch Page leaves the Native Layout intact', async () => {
    // Away from the Watch Page, by clicking the channel link under the video —
    // YouTube's own link, so YouTube's router navigates.
    await startFromKnownVideo();
    await page.eval(`window.__forget()`);
    const { left, nav } = await toChannel();
    const gone = await page.eval(`(() => {
      const root = document.documentElement;
      return {
        page: !!document.querySelector('ytd-browse, ytd-rich-grid-renderer'),
        applied: root.dataset.ysc || null,
        reason: root.dataset.yscReason || null,
        inline: [root.style.getPropertyValue('--ysc-pane-width'), root.style.getPropertyValue('--ysc-pane-height')],
        ours: [...document.querySelectorAll('body *')].filter((e) =>
          (e.id || '').includes('ysc') || [...e.attributes].some((a) => a.name.includes('ysc'))).length,
      };
    })()`);
    gone.nav = nav;
    // In-page, not a reload — which is what the navigation record still being
    // here says: a full document load would have taken it, and with it the
    // extension, and this test would be asserting nothing about navigation at
    // all. It is asserted first, because it decides what the rest is worth.
    // (`finish` is deliberately not required: measured, YouTube fires its
    // page-ready event for most navigations and not for all of them, so an
    // absent one says nothing about whether the page was loaded or navigated.)
    assert.ok(
      gone.nav && gone.nav.start > 0,
      `${left} was loaded rather than navigated to — ${JSON.stringify(gone.nav)}`,
    );
    assert.equal(gone.page, true, 'the page that arrived is not a YouTube page');
    assert.equal(gone.applied, null, 'the layout attribute is still on a page that is not a Watch Page');
    assert.deepEqual(gone.inline, ['', ''], 'the extension left its own properties on the root');
    assert.equal(gone.ours, 0, 'the extension left something of its own in the page');
    assert.equal(gone.reason, 'not-watch-page', 'the Step Aside was not recorded for a page that is not a Watch Page');

    // And back again, to a Watch Page entered from a page that is not one.
    const back = await hopFromChannel();
    assertArranged(back, 'arriving at a Watch Page from a page that is not one');
    assertTornDownFirst(back, 'arriving at a Watch Page from a page that is not one');
    assert.ok(back.threads > 0, 'the Comments did not load on the Watch Page arrived at from a page that is not one');
    assert.ok(back.firstOnScreen, 'the first comment thread is not visible in the Comment Pane');
  });

  test('a Watch Page opened in a background tab is arranged when the tab is shown', async () => {
    // A tab that is not on screen is not rendered, and this is the category's
    // most repeated complaint: a link opened in a background tab whose Comment
    // Pane never appears until a refresh. Opening a tab makes it the active
    // one, so the tab under test is created first and the page already loaded
    // is brought back in front of it, leaving the new one in the background.
    //
    // The page in front is put back on the known video first, because what this
    // test reads from it — the width a reader had chosen — only exists on a page
    // that is arranged: a page that Stepped Aside carries no Pane and no width
    // of its own. That also keeps this test about the tab in the background
    // rather than about whatever the test before it left on screen.
    await startFromKnownVideo();
    const chosen = (await arrangement()).width;
    const hidden = await newPage(browser, null);
    try {
      await page.send('Page.bringToFront');
      const state = await hidden.eval(`document.visibilityState`);
      assert.equal(state, 'hidden', 'the tab under test is not in the background, so it tests nothing about one');

      await hidden.send('Page.navigate', { url: WATCH_URL });
      await hidden.waitFor(`!!document.querySelector('#primary')`, 'the background Watch Page to build', 90_000);
      // What the extension made of the page *while nobody was looking* is
      // recorded rather than asserted: what a reader is owed is the layout when
      // they look at the tab, not that a tab nobody has looked at has one.
      await sleep(4000);
      const background = await hidden.eval(`({
        applied: document.documentElement.dataset.ysc || null,
        reason: document.documentElement.dataset.yscReason || null,
        comments: (document.querySelector('#comments')?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
      })`);

      await hidden.send('Page.bringToFront');
      // Waited out on the tab under test, which is the one that has to be
      // arranged: YouTube loads the Comments only while their element is on
      // screen, so a page that has just been shown is a page whose Comments are
      // still on their way.
      const shown = await poll(
        `document.documentElement.dataset.ysc === 'on' &&
          !!document.querySelector('#ysc-pane ytd-comment-thread-renderer')`,
        90_000,
        hidden,
      );
      assert.ok(
        shown,
        `the Comment Pane never appeared on a Watch Page that was opened in the background — while ` +
          `hidden it was ${JSON.stringify(background)}, and shown it is ${await hidden.eval(`JSON.stringify({
            href: location.href, ready: document.readyState,
            applied: document.documentElement.dataset.ysc || null,
            reason: document.documentElement.dataset.yscReason || null,
            built: !!document.querySelector('#primary'),
            pane: !!document.getElementById('ysc-pane'),
          })`).catch(() => null)}`,
      );
      const r = await arrangement(hidden);
      assertArranged(r, `a Watch Page opened in a background tab, hidden as ${JSON.stringify(background)}`);
      assert.ok(
        r.threads > 0,
        `the Comments did not load into the background tab’s Comment Pane — ${JSON.stringify({
          thread: r.firstThread, pane: r.pane, scrollTop: r.scrollTop, counts: r.counts,
          region: await hidden.eval(`(() => { const c = document.querySelector('#comments');
            return c ? (c.hasAttribute('disable-upgrade') ? 'placeholder' : 'built') + ' kids=' + c.childElementCount +
              ' header=' + !!c.querySelector('ytd-comments-header-renderer') : 'missing'; })()`).catch(() => null),
        })}`,
      );
      assert.ok(
        chosen > 320 && r.width === chosen,
        `the background tab opened at ${r.width}px, not the ${chosen}px the preference was left at`,
      );
    } finally {
      // Left as it was found whether or not the tab behaved: the tests after
      // this one are not run in a tab that is itself in the background, and not
      // on a video the recommendations happened to offer — one of which can be a
      // live stream, whose live chat takes precedence over the Step Aside they
      // are there to check.
      hidden.close();
      await page.send('Page.bringToFront');
      await startFromKnownVideo();
    }
  });

  test('a video whose comments are turned off Steps Aside, leaving YouTube’s notice alone', async () => {
    // The other measured shape of a commentless Watch Page: the region upgrades
    // and holds YouTube's own notice and no comment section at all — the section
    // renderer with no header, no threads and nothing else in it. There is
    // nothing there to relocate, and the notice is YouTube's, not ours.
    await page.eval(`(() => {
      const section = document.createElement('ytd-item-section-renderer');
      section.id = 'sections';
      section.append(document.createElement('ytd-message-renderer'));
      document.querySelector('#comments').replaceChildren(section);
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      return true;
    })()`);
    await stepAside('comments-disabled');
  });

  test('a video YouTube delivers no comments for Steps Aside, leaving no empty Pane', async () => {
    // The measured signature of a Watch Page whose response carries no comment
    // section — taken from live Watch Pages, where the Comments region renders
    // with nothing in it and the watch root has no `response-has-comments`.
    // Relocating that region is exactly how an empty Comment Pane happens.
    await page.eval(`(() => {
      document.querySelector('#comments').replaceChildren();
      document.querySelector('[is-two-columns_]').removeAttribute('response-has-comments');
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      return true;
    })()`);
    await stepAside('comments-disabled');
  });

  test('an unrecognised page Steps Aside and records why', async () => {
    // Destroy the structure the Adapter depends on, exactly as a YouTube
    // change would, and let it re-decide.
    await page.eval(`(() => {
      document.querySelector('#comments').remove();
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      return true;
    })()`);
    await page.waitFor(
      `document.documentElement.dataset.yscReason === 'unrecognised-structure'`,
      'the Step Aside reason to be recorded',
      15_000,
    );
    assert.equal(
      await page.eval(`document.documentElement.dataset.yscReason`),
      'unrecognised-structure',
    );
  });

  // --------------------------------------------- The off switch, and the way back

  /**
   * The toolbar surface, opened as a tab of its own with the Watch Page still
   * the window's active one — which is what Chrome's own popup bubble would be,
   * and which cannot be opened over CDP. Everything else is the real surface:
   * the real `src/popup.html`, reading the real page behind it.
   */
  const openSurface = async () => {
    const surface = await newPage(browser, 'about:blank');
    await page.send('Page.bringToFront');
    await surface.send('Page.navigate', {
      url: `chrome-extension://${browser.extensionId}/src/popup.html`,
    });
    await surface.waitFor(
      `!!document.documentElement.dataset.yscState`,
      'the toolbar surface to read the page behind it',
      20_000,
    );
    return surface;
  };

  /** What the surface says, and what it offers to do about it. */
  const surfaceSays = (surface) =>
    surface.eval(`(() => ({
      state: document.documentElement.dataset.yscState ?? null,
      reason: document.documentElement.dataset.yscReason ?? null,
      canEnable: !document.getElementById('ysc-enable').hidden,
      said: document.getElementById('ysc-reason').textContent.trim(),
    }))()`);

  /** A key a button acts on. Enter carries its own character, which is what the
   *  browser's own button activation waits for — and what the arrow keys the
   *  Splitter takes have no use for. */
  const pressEnter = async (p = page) => {
    const key = {
      key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      text: '\r', unmodifiedText: '\r',
    };
    for (const type of ['keyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', { type, ...key });
  };

  /** The way out of the layout as a reader takes it: the status control in the
   *  Comments' header, then the action in the panel it opens. */
  const turnOff = async () => {
    await clickIn(page, '#ysc-status-button');
    await page.waitFor(
      `!!document.getElementById('ysc-status-panel')?.matches(':popover-open')`,
      'the status panel to open',
      5000,
    );
    await clickIn(page, '#ysc-off');
  };

  /** A real click, by pointer, on an element that has a box — in whichever page
   *  it is in. */
  const clickIn = async (p, selector) => {
    const spot = await p.eval(`(() => {
      const e = document.querySelector(${JSON.stringify(selector)});
      e.scrollIntoView({ block: 'center', behavior: 'instant' });
      const b = e.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await p.send('Input.dispatchMouseEvent', {
        type, ...spot, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1,
      });
    }
  };

  test('the Pane turns the layout off in place, and the toolbar surface brings it back', async () => {
    await startFromKnownVideo();

    // The control, as a reader finds it: in the Comment Pane, in YouTube's own
    // comments header beside the sort control, and no bigger than the row that
    // is already there — the layout may not cost the page a strip of its own.
    const control = await page.eval(`(() => {
      const pane = document.getElementById('ysc-pane');
      const header = pane?.querySelector('ytd-comments-header-renderer');
      const section = header?.querySelector('#additional-section');
      const row = section?.parentElement ?? header?.firstElementChild;
      const sort = header?.querySelector('yt-sort-filter-sub-menu-renderer');
      const handle = document.getElementById('ysc-status');
      const button = handle?.querySelector('button');
      const height = (e) => (e ? +e.getBoundingClientRect().height.toFixed(1) : null);
      button?.focus();
      const focused = document.activeElement === button;
      const withOurs = { row: height(row), header: height(header) };
      // Taken out and put straight back, which is the whole trick: what the row
      // costs without the control is the height the page had before it.
      const home = handle?.parentElement;
      const next = handle?.nextSibling;
      handle?.remove();
      const without = { row: height(row), header: height(header) };
      home?.insertBefore(handle, next);
      button?.focus();
      const box = button?.getBoundingClientRect();
      return {
        inPane: !!pane && !!handle && pane.contains(handle),
        inHeader: !!handle && !!header && header.contains(handle),
        besideSort: !!handle && !!sort &&
          !!(sort.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING),
        inRow: !!handle && !!row && row.contains(handle),
        tag: button?.tagName ?? null,
        label: button?.getAttribute('aria-label') ?? null,
        focusable: button?.tabIndex === 0,
        focused,
        size: [Math.round(box?.width ?? 0), Math.round(box?.height ?? 0)],
        icon: height(button?.querySelector('svg')),
        // Closed, and so costing the row nothing at all.
        panelShut: !document.getElementById('ysc-status-panel')?.matches(':popover-open'),
        withOurs, without,
      };
    })()`);
    assert.equal(control.inPane, true, 'the control is not in the Comment Pane');
    assert.equal(control.inHeader, true, "the control is not in YouTube's own comments header");
    assert.equal(control.inRow, true, 'the control is not in the header row itself');
    assert.equal(control.besideSort, true, 'the control is not beside the sort control');
    assert.equal(control.tag, 'BUTTON', 'the control is not a button');
    assert.ok(/side comments/i.test(control.label ?? ''), `the control is not labelled: ${control.label}`);
    assert.equal(control.focusable, true, 'the control cannot take focus');
    assert.equal(control.focused, true, 'the control did not take focus');
    assert.deepEqual(control.size, [24, 24], `the control is ${control.size} where the row beside it is 24px`);
    assert.equal(control.icon, 24, 'the control does not carry a 24px icon');
    assert.equal(control.panelShut, true, 'the status panel is open before anybody asked for it');
    assert.equal(
      control.withOurs.row, control.without.row,
      `the control makes the comments header row ${control.withOurs.row}px where the page had ${control.without.row}px`,
    );
    assert.equal(
      control.withOurs.header, control.without.header,
      `the control makes the comments header ${control.withOurs.header}px where the page had ${control.without.header}px`,
    );

    // YouTube rebuilds that header on its own account — the count arrives, the
    // sort menu is re-rendered, the whole row is replaced — and anything inside
    // it goes with the rebuild. The control is dropped here the way a rebuild
    // drops it, and has to come back on its own.
    const back = await page.eval(`(async () => {
      const handle = document.getElementById('ysc-status');
      const home = handle.parentElement;
      handle.remove();
      await new Promise((r) => setTimeout(r, 500));
      const there = document.getElementById('ysc-status');
      return {
        back: !!there,
        inTheSameRow: !!there && there.parentElement === home,
        copies: document.querySelectorAll('#ysc-status').length,
      };
    })()`, { awaitPromise: true });
    assert.deepEqual(
      back,
      { back: true, inTheSameRow: true, copies: 1 },
      'the control did not come back after the comments header dropped it',
    );

    // Opened and used from the keyboard, on the focus the read above took: what
    // a reader who tabbed here does, rather than what a script can do to them.
    await page.eval(`document.getElementById('ysc-status-button').focus()`);
    await pressEnter();
    const panel = await page.eval(`(() => {
      const el = document.getElementById('ysc-status-panel');
      const box = el?.getBoundingClientRect();
      return {
        open: !!el?.matches(':popover-open'),
        state: el?.dataset.yscState ?? null,
        reason: el?.dataset.yscReason ?? null,
        said: document.getElementById('ysc-status-said').textContent.trim(),
        width: document.getElementById('ysc-status-width').textContent.trim(),
        hint: document.getElementById('ysc-status-hint').textContent.trim(),
        offersOff: !document.getElementById('ysc-off').hidden,
        // Placed where it can be read: in the window, over the Pane it belongs
        // to rather than clipped by it.
        inWindow: !!box && box.left >= 0 && box.right <= innerWidth + 1 &&
          box.top >= 0 && box.bottom <= innerHeight + 1,
        // Open and costing the row nothing, which is what a panel floating
        // above the page is for.
        row: +document.querySelector('#ysc-pane ytd-comments-header-renderer #additional-section')
          .parentElement.getBoundingClientRect().height.toFixed(1),
      };
    })()`);
    assert.equal(panel.open, true, 'the keyboard did not open the status panel');
    assert.equal(panel.state, 'applied', `the status panel reads the page as ${panel.state}`);
    assert.equal(panel.reason, null, 'the status panel reports a reason the engine did not record');
    assert.ok(/side comments are on/i.test(panel.said), `the status panel says ${JSON.stringify(panel.said)}`);
    assert.ok(/Comment Pane: \d+px/.test(panel.width), `the status panel does not say the Pane's width: ${panel.width}`);
    assert.ok(/toolbar/i.test(panel.hint), 'the status panel does not say where a reason is readable with no Pane');
    assert.equal(panel.offersOff, true, 'the status panel offers no way out of the layout');
    assert.equal(panel.inWindow, true, 'the status panel was placed outside the window');
    assert.equal(
      panel.row, control.withOurs.row,
      `the open status panel makes the comments header row ${panel.row}px where it was ${control.withOurs.row}px`,
    );

    await page.eval(`document.getElementById('ysc-off').focus()`);
    await pressEnter();
    // Ticket 02's standard, verbatim: not a container missing, but a page that
    // is the Native Layout exactly — the Comments back at their original parent
    // and position, the related videos back in the rail's own single column, and
    // nothing of ours anywhere on the page.
    await stepAside('disabled');

    const surface = await openSurface();
    try {
      const off = await surfaceSays(surface);
      assert.equal(off.state, 'off', 'the toolbar surface does not read the page as switched off');
      assert.equal(off.reason, 'disabled', `the surface reports ${off.reason}, not the reason the engine recorded`);
      assert.equal(off.canEnable, true, 'the toolbar surface offers no way back');
      assert.ok(off.said.length > 0, 'the toolbar surface says nothing about why');

      // The same document throughout: the layout comes back by re-arranging,
      // not by a reload.
      await page.eval(`window.__here = true`);
      await clickIn(surface, '#ysc-enable');
      await page.waitFor(`document.documentElement.dataset.ysc === 'on'`, 'the layout to come back', 20_000);
      assert.equal(await page.eval(`window.__here === true`), true, 'the page reloaded rather than re-arranging');
      const back = await arrangement();
      assertArranged(back, 'brought back through the toolbar surface');
      assert.ok(back.threads > 0, 'the Comments did not load into the Comment Pane again');
    } finally {
      surface.close();
      await page.send('Page.bringToFront');
    }
  });

  test('a page loaded while the layout is off comes up in the Native Layout', async () => {
    await startFromKnownVideo();
    await turnOff();
    await stepAside('disabled');

    // A cold document with the preference already stored. Reading it before the
    // first decision is what is under test here, and `__paneSeen` is what proves
    // it: a layout applied and taken back would leave it true.
    await page.send('Page.reload');
    await page.waitFor(`!!document.querySelector('#primary')`, 'the Watch Page to load again', 60_000);
    await stepAside('disabled');
    const seen = await page.eval(
      `({ paneSeen: window.__paneSeen, reason: document.documentElement.dataset.yscReason })`,
    );
    assert.equal(seen.reason, 'disabled', 'a page loaded while the layout was off was not left in the Native Layout');
    assert.equal(seen.paneSeen, false, 'the layout was applied and undone rather than never applied at all');

    const surface = await openSurface();
    try {
      await clickIn(surface, '#ysc-enable');
      await page.waitFor(`document.documentElement.dataset.ysc === 'on'`, 'the layout to come back', 20_000);
    } finally {
      surface.close();
      await page.send('Page.bringToFront');
    }
  });

  test('the toolbar surface reports the reason where there is no Pane, including one nobody asked for', async () => {
    await startFromKnownVideo();
    // An automatic Step Aside with no Comment Pane anywhere: YouTube's own
    // single column, reached by narrowing the window rather than by any toggle.
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 700, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await page.waitFor(
      `document.documentElement.dataset.yscReason === 'single-column'`,
      'the automatic Step Aside',
      15_000,
    );

    const surface = await openSurface();
    try {
      const said = await surfaceSays(surface);
      const recorded = await page.eval(`document.documentElement.dataset.yscReason`);
      assert.equal(said.reason, recorded, `the surface reports ${said.reason} where the page recorded ${recorded}`);
      assert.equal(said.state, 'stepped-aside', 'the surface does not read an automatic Step Aside as one');
      assert.equal(said.canEnable, false, 'the surface offers to turn on what the page itself refused');
      assert.ok(said.said.length > 0, 'no reason is visible on a page with no Comment Pane');

      // And a second one, of the kind that is a property of the page rather than
      // of a moment: theater mode persists across loads, so it is forced here
      // exactly as YouTube delivers it.
      await page.eval(`(() => {
        document.querySelector('#primary').closest('[is-two-columns_],[is-single-column]')
          .setAttribute('theater', '');
        window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
        return true;
      })()`);
      await page.waitFor(
        `document.documentElement.dataset.yscReason === 'theater'`,
        'the theater Step Aside',
        15_000,
      );
      await surface.send('Page.reload');
      await surface.waitFor(
        `!!document.documentElement.dataset.yscState`,
        'the surface to read the page again',
        20_000,
      );
      const theater = await surfaceSays(surface);
      assert.equal(
        theater.reason,
        'theater',
        `the surface reports ${theater.reason} where the page recorded theater`,
      );
      assert.ok(theater.said.length > 0, 'no reason is visible for a theater-mode page');
      await page.eval(`document.querySelector('[theater]').removeAttribute('theater')`);
    } finally {
      surface.close();
      await page.send('Page.bringToFront');
    }

    await page.send('Emulation.clearDeviceMetricsOverride');
    await page.waitFor(`document.documentElement.dataset.ysc === 'on'`, 'the layout to come back', 15_000);
  });

  // Last, because it makes theater mode stick: YouTube persists it once it has
  // seen it, which is the very property this test exists to check.
  test('theater mode is detected at load, not only on toggle', async () => {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: LOAD_IN_THEATER });
    await page.send('Page.reload');
    await stepAside('theater');

    const r = await page.eval(`({ seen: window.__paneSeen, reason: document.documentElement.dataset.yscReason })`);
    assert.equal(r.reason, 'theater', 'a page that loads in theater mode was not recognised as theater');
    assert.equal(r.seen, false, 'the layout was applied and undone rather than never applied at all');
  });
});
