/**
 * Capture the screenshots the README points at.
 *
 * Runs the real extension in a real browser against a real Watch Page, on a
 * fresh profile — so the shots show what a reader gets, signed out, with no
 * account data in them.
 *
 *   node tools/screenshots.mjs
 *
 * Writes into docs/screenshots/. Skips nothing silently: a shot that cannot be
 * taken is reported and the run continues, so one missing image never costs the
 * others.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launch, newPage, sleep } from '../test-support/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');
const WATCH = process.env.YSC_SMOKE_URL || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

mkdirSync(OUT, { recursive: true });

const browser = await launch({ extension: ROOT, width: 1600, height: 950 });
const page = await newPage(browser, WATCH);

const shot = async (name, { fullPage = false } = {}) => {
  const { data } = await page.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: fullPage,
  });
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  wrote ${name}.png`);
};

try {
  await page.waitFor(`!!document.querySelector('#primary')`, 'the Watch Page', 60_000);
  try {
    await page.waitFor(
      `!!document.querySelector('#ysc-pane ytd-comment-thread-renderer')`,
      'the Comments to load in the Comment Pane',
      90_000,
    );
  } catch (error) {
    // Report what the browser actually had rather than a bare timeout — a
    // screenshot run that fails should say why.
    console.log(`  ${error.message}`);
    console.log(
      await page.eval(`JSON.stringify({
        url: location.href,
        ysc: document.documentElement.dataset.ysc || null,
        reason: document.documentElement.dataset.yscReason || null,
        pane: !!document.getElementById('ysc-pane'),
        threads: document.querySelectorAll('#ysc-pane ytd-comment-thread-renderer').length,
        commentsRegion: (document.querySelector('#comments')?.innerText || '').slice(0, 120),
      }, null, 1)`),
    );
    throw error;
  }
  await sleep(3000);

  // 1. The layout itself: Comments beside the Player, metadata untouched.
  await page.eval(`window.scrollTo(0, 0)`);
  await sleep(400);
  await shot('01-comments-beside-the-video');

  // 2. The Recommendation Strip, below both columns. Scrolled to it at native
  //    resolution rather than captured as a full page: a full-page grab of a
  //    5000px document downscales the tiles to illegibility.
  await page.eval(`(() => {
    const s = document.getElementById('ysc-strip');
    if (s) window.scrollTo(0, s.getBoundingClientRect().top + window.scrollY - 90);
  })()`);
  await sleep(700);
  await shot('02-recommendations-below');

  // 3. A drag in progress: the Pane widened, the Splitter at its marked state.
  // Back to the top *before* reading the Splitter's position — it is sticky, so
  // its coordinates depend on the scroll offset, and reading them from the
  // scrolled position and then clicking would aim at where it no longer is.
  await page.eval(`window.scrollTo(0, 0)`);
  await sleep(500);
  const box = await page.eval(`(() => {
    const s = document.getElementById('ysc-splitter');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 300) };
  })()`);
  if (box) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...box });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', buttons: 1, clickCount: 1 });
    for (const dx of [40, 80, 120, 160, 200]) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x - dx, y: box.y, button: 'left', buttons: 1 });
      await sleep(90);
    }
    await sleep(300);
    await shot('03-dragging-the-splitter');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x - 200, y: box.y, button: 'left', buttons: 0 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x - 200, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(600);
  } else {
    console.log('  no Splitter on the page — skipped 03');
  }

  // 4. The in-page status control, open. This is the only place a reader can
  //    find out why the layout stood aside, so it earns a shot.
  const opened = await page.eval(`(() => {
    const b = document.getElementById('ysc-status-button');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (opened) {
    await sleep(600);
    await shot('04-status-and-off-switch');
    await page.eval(`document.getElementById('ysc-status-button')?.click()`);
  } else {
    console.log('  no status control on the page — skipped 04');
  }

  // 5. The native layout, for comparison: what the page looks like with the
  //    extension switched off. Driven through the extension's own off switch,
  //    so it is the real Step Aside rather than a second browser.
  const off = await page.eval(`(() => {
    const b = document.getElementById('ysc-off');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (off) {
    await sleep(1500);
    await page.eval(`window.scrollTo(0, 0)`);
    await sleep(400);
    await shot('05-native-layout');
  } else {
    console.log('  could not reach the off switch — skipped 05');
  }
} finally {
  page.close();
  await browser.close();
}
