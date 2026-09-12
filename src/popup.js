/**
 * The toolbar surface.
 *
 * The one thing that can speak when there is no Comment Pane: it turns the
 * layout back on, and it reports what the Layout Engine decided about the page
 * behind it. The two directions have different homes because the in-page control
 * cannot survive its own action — see `src/toggle.js` for why that is the design
 * rather than a gap.
 *
 * The reason is not remembered here, and there is deliberately no copy of it in
 * storage: it is read from the page, which is where the engine recorded it, so
 * what is shown is the engine's most recent decision — including the automatic
 * Step Asides nobody asked for — rather than a second-hand record of it.
 */
import { surfaceFor } from './engine.js';
// The same sentences the Comment Pane's own status view renders, from one place,
// so the two surfaces cannot tell a reader different things about one decision.
import { STATUS, WHY } from './words.js';

const status = document.getElementById('ysc-status');
const reason = document.getElementById('ysc-reason');
const enable = document.getElementById('ysc-enable');

/** Runs in the page behind the surface. The markers are the extension's own,
 *  so a page that carries neither is one it has said nothing about. */
function inPage() {
  const root = document.documentElement;
  return { applied: root.dataset.ysc === 'on', reason: root.dataset.yscReason || null };
}

/** What the engine makes of the page behind the surface, right now. */
async function read() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let page = null;
  // Only a YouTube page can carry the markers; asking anything else would be a
  // question the extension has no answer to. A page this cannot read — one that
  // has just navigated away — leaves the surface with nothing to report.
  if (tab?.url?.startsWith('https://www.youtube.com/')) {
    try {
      const [ran] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: inPage });
      page = ran?.result ?? null;
    } catch { /* nothing to say about a page we cannot read */ }
  }
  const { enabled } = await chrome.storage.local.get('enabled');
  return surfaceFor({ enabled: enabled !== false, ...page });
}

async function render() {
  const decision = await read();
  // On the root, so that what the surface decided is as readable as what the
  // page recorded — which is what lets a test hold the two against each other.
  document.documentElement.dataset.yscState = decision.state;
  status.textContent = STATUS[decision.state] ?? '';
  if (decision.reason) {
    document.documentElement.dataset.yscReason = decision.reason;
    reason.textContent = WHY[decision.reason] ?? '';
  } else {
    delete document.documentElement.dataset.yscReason;
    reason.textContent = '';
  }
  reason.hidden = !decision.reason;
  enable.hidden = !decision.canEnable;
}

enable.addEventListener('click', async () => {
  await chrome.storage.local.set({ enabled: true });
  // Long enough for the page to hear the change and re-arrange itself, so what
  // the surface says next is what the reader can see, not what it hoped for.
  setTimeout(render, 250);
});

render();
