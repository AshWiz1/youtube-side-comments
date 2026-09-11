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

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), '..');
const WATCH_URL = process.env.YSC_SMOKE_URL || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

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
  addEventListener('resize', () => { window.__resizes++; });
  const sig = (e) => e ? (e.tagName || '').toLowerCase() + (e.id ? '#' + e.id : '') : null;
  const chain = (e) => { const a = []; for (let n = e; n && n !== document.documentElement; n = n.parentElement) a.push(sig(n)); return a; };
  const grab = (records) => {
    if (records.some((r) => [...r.addedNodes].some((n) => n.id === 'ysc-pane'))) window.__paneSeen = true;
    const c = document.querySelector('#comments');
    if (c && !window.__native) {
      window.__native = { parent: c.parentElement, chain: chain(c.parentElement),
        prev: sig(c.previousElementSibling), next: sig(c.nextElementSibling) };
    }
  };
  new MutationObserver(grab).observe(document, { childList: true, subtree: true });
  grab([]);
`;

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
      // environment. Report what the browser actually had.
      const seen = await page
        .eval(`({ url: location.href, title: document.title, h1: document.body.innerText.slice(0, 200) })`)
        .catch(() => ({}));
      throw new Error(
        `${error.message}\n  url:   ${seen.url}\n  title: ${seen.title}\n  page:  ${JSON.stringify(seen.h1)}\n` +
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
      return {
        reason: document.documentElement.dataset.yscReason ?? null,
        applied: document.documentElement.dataset.ysc ?? null,
        inline: document.documentElement.style.getPropertyValue('--ysc-pane-width'),
        pane: !!document.getElementById('ysc-pane'),
        residue: [...document.querySelectorAll('body *')]
          .filter((e) => (e.id || '').includes('ysc') || [...e.attributes].some((a) => a.name.includes('ysc'))).length,
        sameParent: comments?.parentElement === window.__native?.parent,
        chain: chain(comments?.parentElement).join('<'),
        nativeChain: (window.__native?.chain || []).join('<'),
        prev: sig(comments?.previousElementSibling),
        next: sig(comments?.nextElementSibling),
        nativePrev: window.__native?.prev,
        nativeNext: window.__native?.next,
        inRail: !!document.querySelector('#secondary-inner #comments'),
      };
    })()`);

    assert.equal(r.reason, reason, 'the Step Aside reason was not recorded');
    assert.equal(r.applied, null, 'the root still carries the layout attribute');
    assert.equal(r.inline, '', 'an inline pane width was left on the root');
    assert.equal(r.pane, false, 'the Comment Pane was left behind');
    assert.equal(r.residue, 0, 'the extension left its own attributes on the page');
    assert.equal(r.sameParent, true, 'the Comments are not back at their exact original parent');
    assert.equal(r.chain, r.nativeChain, 'the Comments are back at the wrong nesting depth');
    assert.equal(r.prev, r.nativePrev, 'the Comments moved relative to the element before them');
    assert.equal(r.next, r.nativeNext, 'the Comments moved relative to the element after them');
    assert.equal(r.inRail, false, 'the Comments are still in the right rail');
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
        const { left, right, top, width } = e.getBoundingClientRect(); return { left, right, top, width }; };
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
    for (const id of ['related', 'panels', 'playlist', 'chat-container']) {
      assert.ok(r.rail.includes(id), `${id} was displaced from the rail: ${r.rail.join(', ')}`);
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
