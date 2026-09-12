/**
 * The control that leaves the layout, and the status view behind it.
 *
 * One icon in YouTube's comments header — where a reader is already looking, in
 * a row that already exists — opening a small panel that says what the extension
 * is doing on this page and offers the way out. One mark rather than two: the
 * header row has room for one, and the state and the action belong together.
 *
 * It goes one direction only, and that is the design rather than an omission:
 * leaving the layout removes the Comment Pane, and this control lives in the
 * Pane, so it cannot survive its own action. The way back is the toolbar surface
 * (`src/popup.js`). The same limit applies to the status this shows: with no
 * Pane there is no status view, so the reason on a page the extension Stepped
 * Aside from is only ever readable in the toolbar — which is why the toolbar
 * surface is load-bearing rather than decorative, and why this panel says so.
 *
 * The element is placed by the Adapter, which owns what goes into the page; this
 * module owns what the element does and what it looks like.
 */
import { surfaceFor, SURFACE } from './engine.js';
import { STATUS, WHY, ELSEWHERE_HINT } from './words.js';

/**
 * The mark the control carries: the layout this extension makes — a column
 * beside a narrower one — drawn at the 2px weight of YouTube's own glyphs on a
 * 24px grid, in the colour of whatever row it is put in.
 */
const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
<path d="M3 5h18v2H3zM3 17h18v2H3zM3 7h2v10H3zM19 7h2v10H19zM13 7h2v10h-2z"/>
</svg>`;

/** The panel's width, so that it can be placed before it has been laid out. */
const PANEL_WIDTH = 244;

/**
 * @param {object} deps
 * @param {Document} deps.doc  The document to build the control in.
 * @param {() => void} deps.onOff  The reader has asked for the Native Layout.
 * @param {() => {enabled: boolean, applied: boolean, reason: string|null, width: number}} deps.read
 *   What the page says about itself, read fresh: the stored preference, the two
 *   markers the Adapter writes, and the width the Pane is actually at. The
 *   decision is not made here — `surfaceFor` makes it, so this renders what the
 *   engine decided rather than a second opinion about it.
 * @returns {{handle: HTMLElement}}
 */
export function createToggle({ doc, onOff, read }) {
  // One node for the Adapter to place, hold and take back out: everything the
  // control is made of goes inside it.
  const handle = doc.createElement('span');
  handle.id = 'ysc-status';

  const button = doc.createElement('button');
  button.id = 'ysc-status-button';
  button.type = 'button';
  // The panel is opened by the browser rather than by a handler of ours, which
  // is what makes Escape close it, a click outside dismiss it, and the panel
  // itself escape the Pane's own clipping — it is rendered in the top layer,
  // where a scrolling box cannot cut it off.
  button.setAttribute('popovertarget', 'ysc-status-panel');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-label', 'Side Comments status');
  button.title = 'Side Comments status';
  button.innerHTML = ICON;

  const panel = doc.createElement('div');
  panel.id = 'ysc-status-panel';
  panel.setAttribute('popover', 'auto');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Side Comments status');

  const said = doc.createElement('p');
  said.id = 'ysc-status-said';
  const why = doc.createElement('p');
  why.id = 'ysc-status-why';
  const width = doc.createElement('p');
  width.id = 'ysc-status-width';
  const off = doc.createElement('button');
  off.id = 'ysc-off';
  off.type = 'button';
  off.textContent = 'Turn off side comments';
  const hint = doc.createElement('p');
  hint.id = 'ysc-status-hint';
  hint.textContent = ELSEWHERE_HINT;
  panel.append(said, why, width, off, hint);
  handle.append(button, panel);

  /** What the panel says, from the decision the engine makes about the page. */
  function render() {
    const page = read();
    const decision = surfaceFor(page);
    // On the panel, so that what it decided is as readable as what the page
    // recorded — which is what lets a test hold the two against each other, and
    // the same contract the toolbar surface keeps.
    panel.dataset.yscState = decision.state;
    if (decision.reason) panel.dataset.yscReason = decision.reason;
    else delete panel.dataset.yscReason;

    said.textContent = STATUS[decision.state] ?? '';
    why.textContent = decision.reason ? (WHY[decision.reason] ?? '') : '';
    why.hidden = !decision.reason;
    // The width is the one fact here the engine did not decide: it is what the
    // Splitter last left the Pane at, so it is read rather than reported.
    width.textContent = page.applied && page.width ? `Comment Pane: ${Math.round(page.width)}px` : '';
    width.hidden = !width.textContent;
    off.hidden = decision.state !== SURFACE.APPLIED;

    // Under the icon that opened it, and inside the window: the panel is fixed
    // in the top layer, so these are viewport coordinates. The width is the
    // stylesheet's, because a panel that has not been laid out yet measures as
    // nothing.
    const room = doc.documentElement.clientWidth;
    const wide = panel.offsetWidth || PANEL_WIDTH;
    const box = button.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(box.right - wide, room - wide - 8))}px`;
    panel.style.top = `${Math.round(box.bottom + 6)}px`;
  }

  // Rendered as it opens rather than as it is built, so that what it says is
  // what the page says now — the state and the reason both move on their own.
  panel.addEventListener('toggle', (event) => {
    if (event.newState === 'open') render();
  });
  off.addEventListener('click', onOff);

  return { handle };
}
