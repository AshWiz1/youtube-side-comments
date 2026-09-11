/**
 * Headless-Chrome harness for the smoke test.
 *
 * Drives Chrome DevTools Protocol over Node's built-in `fetch` and `WebSocket`
 * — no npm dependencies, no Playwright, no Puppeteer.
 *
 * Every launch gets a **fresh `--user-data-dir`**. Reusing a profile silently
 * carries over theater mode, volume, autoplay and quality settings, which is a
 * known source of false results.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Launch Chrome, headless, with `extension` loaded into a fresh profile.
 *
 * `--load-extension` / `--disable-extensions-except` are deliberately **not**
 * used. On Chrome 152 (branded, Windows) they are accepted and then silently
 * ignored — no content script is ever injected — and passing them *alongside*
 * the mechanism that does work suppresses that one too. `Extensions.loadUnpacked`
 * over CDP is the supported path, and is the only one measured to inject the
 * content script.
 */
export async function launch({ extension, width = 1920, height = 1080, extraArgs = [] }) {
  const profile = await mkdtemp(join(tmpdir(), 'ysc-smoke-'));
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      `--window-size=${width},${height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-search-engine-choice-screen',
      '--mute-audio',
      '--lang=en-US',
      ...extraArgs,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('error', (e) => { stderr += `spawn failed: ${e.code}\n`; });

  let port = null;
  for (let i = 0; i < 120 && child.exitCode === null; i++) {
    try {
      port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim();
      break;
    } catch { await sleep(250); }
  }
  if (!port) {
    child.kill();
    throw new Error(`Chrome never wrote DevToolsActivePort.\n${stderr.slice(-800)}`);
  }

  const browser = {
    port,
    profile,
    extensionId: null,
    stderr: () => stderr,
    async close() {
      try {
        const ws = await connectBrowser(port);
        await ws.send('Browser.close').catch(() => {});
        await sleep(300);
        ws.close();
      } catch { /* already gone */ }
      await sleep(500);
      child.kill();
      for (let i = 0; i < 20; i++) {
        try { await rm(profile, { recursive: true, force: true }); break; }
        catch { await sleep(250); }
      }
    },
  };

  if (extension) {
    const ws = await connectBrowser(port);
    ({ id: browser.extensionId } = await ws.send('Extensions.loadUnpacked', { path: extension }));
    ws.close();
  }
  return browser;
}

/** A CDP session against the browser rather than a page. */
async function connectBrowser(port) {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
      }),
    close: () => ws.close(),
  };
}

/**
 * A CDP session against one page target.
 *
 * `preload` is evaluated in every new document before any page script runs,
 * which is the only way to observe events that fire during startup.
 */
export async function newPage(browser, url, { preload } = {}) {
  const target = await (
    await fetch(`http://127.0.0.1:${browser.port}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  /** Every isolated world Chrome created — where a content script actually runs. */
  const worlds = [];
  const console_ = [];
  let id = 0;

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.executionContextCreated') {
      const c = m.params.context;
      if (!c.auxData?.isDefault) worlds.push(c);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      console_.push(
        `[${m.params.type}] ` +
          (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '),
      );
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      console_.push(`[exception] ${d.exception?.description || d.text}`);
    }
  });

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable').catch(() => {});
  if (preload) await send('Page.addScriptToEvaluateOnNewDocument', { source: preload });
  if (url) await send('Page.navigate', { url });

  const page = {
    send,
    worlds,
    console: console_,
    /** Run an expression in the page's main world and return its value. */
    async eval(expression, { awaitPromise = false } = {}) {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      if (res.exceptionDetails) {
        throw new Error(`${res.exceptionDetails.text} ${res.result?.description || ''}`.trim());
      }
      return res.result.value;
    },
    /** Poll until `expression` is truthy, or throw naming what was awaited. */
    async waitFor(expression, label, timeoutMs = 45_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        try { if (await page.eval(expression)) return; } catch { /* mid-navigation */ }
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
        await sleep(300);
      }
    },
    close() { ws.close(); },
  };
  return page;
}
