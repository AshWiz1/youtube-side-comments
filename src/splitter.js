/**
 * The Splitter — pointer and keyboard input for the divider between the Player
 * and the Comment Pane.
 *
 * This module turns a gesture into a *requested* width and does nothing else
 * with it. It resolves nothing itself: the pointer and the arrow keys both hand
 * their request to the one `resolve`, which is the Layout Engine's clamp, so the
 * two paths cannot end up disagreeing about where the floor and the ceiling are.
 *
 * The element is placed by the Adapter, which owns what goes into the page; this
 * module only owns what the element does.
 */
import { DEFAULT_PANE_WIDTH, MIN_PANE_WIDTH } from './engine.js';

/** How far one arrow key moves the Splitter. */
export const KEYBOARD_STEP = 16;

/** Asking for more than this is asking for the ceiling, whatever it is. */
const MORE_THAN_ANY_PANE = 1e7;

/**
 * @param {object} deps
 * @param {Document} deps.doc     The document to listen on.
 * @param {(requested: number) => number} deps.resolve  Requested width in,
 *   clamped width out — the Layout Engine's own resolution.
 * @param {() => number} deps.getWidth  The width currently applied to the Pane,
 *   read fresh rather than remembered, so a width that changed behind the
 *   Splitter's back is still the width the next gesture starts from.
 * @param {(width: number) => void} deps.onResize  Apply a width, live.
 * @param {(width: number) => void} deps.onCommit  Persist a width, once the
 *   gesture that chose it is over.
 * @returns {{handle: HTMLElement}}
 */
export function createSplitter({ doc, resolve, getWidth, onResize, onCommit, step = KEYBOARD_STEP }) {
  const handle = doc.createElement('div');
  handle.id = 'ysc-splitter';
  // A focusable separator is a range control, so assistive technology needs to
  // know what it separates, which way it runs, and where it currently sits.
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', 'Resize the Comment Pane');
  handle.tabIndex = 0;

  /** The gesture in flight, if any: where the pointer started, and the width the
   *  Pane had when it did. */
  let drag = null;

  const currentWidth = () => getWidth();

  /** A gesture's request, through the one clamp, applied only when it lands on a
   *  width the Pane is not already at. */
  function request(width) {
    const resolved = resolve(width);
    if (resolved === currentWidth()) return false;
    onResize(resolved);
    syncRange(resolved);
    return true;
  }

  /** While a gesture runs the whole page is dragging: no text selection, and a
   *  resize cursor over everything, or the cursor flickers to whatever it
   *  happens to cross. */
  function dragging(on) {
    if (on) doc.documentElement.dataset.yscDrag = '';
    else delete doc.documentElement.dataset.yscDrag;
  }

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    // Capture first, so the gesture survives the pointer leaving the element and
    // a release outside it still ends it. Guarded, because a capture that fails
    // must not cost us the drag — the document listeners below catch whatever
    // capture cannot.
    try {
      handle.setPointerCapture(event.pointerId);
    } catch { /* no capture, still draggable */ }
    drag = { x: event.clientX, width: currentWidth(), moved: false };
    handle.focus();
    dragging(true);
  });

  // On the document rather than the handle: capture retargets the event to the
  // handle and it still bubbles through here, while a gesture the capture missed
  // arrives here regardless. One listener serves both.
  doc.addEventListener('pointermove', (event) => {
    if (!drag) return;
    // The layout was taken down mid-gesture — theater mode, a navigation — so
    // there is no Pane to resize and no width worth committing.
    if (!handle.isConnected) {
      drag = null;
      dragging(false);
      return;
    }
    // Relative, not absolute: the width follows how far the pointer has
    // travelled, so the drag cannot jump on grab and does not care where the
    // Pane's edge happens to sit.
    if (request(drag.width + (drag.x - event.clientX))) drag.moved = true;
  });

  /** End the gesture wherever it ends: over the handle, outside it, or cancelled
   *  by the browser. Idempotent, so a stray second `pointerup` cannot commit a
   *  width twice. */
  const end = () => {
    if (!drag) return;
    const { moved } = drag;
    drag = null;
    dragging(false);
    if (moved) onCommit(currentWidth());
  };
  doc.addEventListener('pointerup', end);
  doc.addEventListener('pointercancel', end);

  handle.addEventListener('keydown', (event) => {
    // Left grows the Pane and right shrinks it: the Pane is what sits to the
    // right of the Splitter.
    const delta = event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0;
    if (!delta) return;
    event.preventDefault(); // arrows move the Splitter, they do not scroll the page
    if (request((currentWidth() || DEFAULT_PANE_WIDTH) + delta)) onCommit(currentWidth());
  });

  /** Double-click is the one gesture that says "put it back": the width a Pane
   *  has on a page that has never been dragged. */
  handle.addEventListener('dblclick', () => {
    if (request(DEFAULT_PANE_WIDTH)) onCommit(currentWidth());
  });

  /** What assistive technology is told, kept in step with what is on screen.
   *  Re-read on focus, which is when it is actually announced — and which is
   *  also when a width the engine changed on its own behalf gets picked up. */
  function syncRange(width) {
    const ceiling = resolve(MORE_THAN_ANY_PANE);
    handle.setAttribute('aria-valuemin', String(MIN_PANE_WIDTH));
    if (Number.isFinite(width) && width > 0) {
      handle.setAttribute('aria-valuenow', String(Math.round(width)));
    }
    if (Number.isFinite(ceiling)) {
      handle.setAttribute('aria-valuemax', String(Math.round(ceiling)));
    }
  }
  // The static half of the range is set here; the rest waits for a focus or a
  // gesture, so that nothing reaches back into the page before the Adapter that
  // owns it exists.
  handle.setAttribute('aria-valuemin', String(MIN_PANE_WIDTH));
  handle.addEventListener('focus', () => syncRange(currentWidth()));

  return { handle };
}
