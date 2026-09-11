# 03: The Splitter

**What to build:** Drag the vertical divider between the Player and the Comment Pane and the Pane resizes to follow. The width stops at sensible limits on both sides, survives navigation and restarts, and the Player stays correctly sized throughout. This is the feature the whole project is differentiated by, so it is the one thing not to compromise on.

**Blocked by:** 01: The Comment Pane appears beside the Player

**Status:** ready-for-agent

- [x] Dragging the Splitter resizes the Comment Pane continuously, following the pointer.
- [x] The Comment Pane stops shrinking at a floor that keeps it readable, and the Player stops shrinking at a width that keeps it usable.
- [x] The Pane's default width matches the width of YouTube's own right rail, so the Pane occupies exactly the space the Recommendation Strip vacated.
- [x] The width ceiling is the lesser of a proportion of the container and the container minus the measured-safe player minimum, keeping the layout out of widths that were never measured.
- [x] The Player's column and its chain of ancestors have their minimum width overridden, so that YouTube's own floor does not silently cap the drag before it reaches the ceiling.
- [x] After every width change the Player's video element and control bar match the Player's actual size, with no overflow beyond its frame.
- [x] The resize notification dispatched after a width change is debounced during a drag so that dragging stays smooth.
- [x] Double-clicking the Splitter restores the default width.
- [x] The Splitter is focusable and moves with the arrow keys.
- [x] The Splitter is exposed to assistive technology as a separator between the Player and the Comment Pane.
- [x] Dragging does not select page text, and the cursor stays a resize cursor for the whole gesture.
- [x] The chosen width persists across navigation and browser restarts as a single global preference, not a per-video one.
- [x] Pointer and keyboard input resolve a width through the same clamping logic, so the two paths cannot disagree.

## Comments

Completed and verified live in headless Chrome on a fresh profile, with **real pointer input** (`Input.dispatchMouseEvent`) rather than synthesized events. 68 tests pass (50 pure-engine, 18 end-to-end).

**Dragging genuinely resizes the Pane.** A real 240px drag took the Pane 402 → 642px, and the Player frame 1439 → 1199px — the width comes out of the Player, as intended. The Pane was already at 522px when the pointer was halfway, so it follows the gesture rather than jumping at the end. A drag to the window's edge stopped at 1133.4px, exactly `min(0.6 × 1889, 1889 − 480)`; a drag back stopped at 320px. Arrow keys move it by 16px a press and double-click restores 402px.

**The Player's internals stay resynced — measured.** Widening the Pane from 402px to 900px with no notification leaves the `<video>` **498px wider than its frame, indefinitely** (1439px inside a 941px frame), reproducing the recorded fact exactly; one synthetic `window` resize lands it at 941/941. After every width change the smoke test asserts the `<video>`'s rect **and** its inline `style.width` equal the Player's frame, with the control bar beside it and no overflow. Both were proven load-bearing by negative controls: deleting the debounced dispatch fails 4 of the 5 Splitter tests (the drag times out after 10s of the Player never catching up), and making the dispatch immediate fails the debounce test at **18 resyncs for eight width changes in 2 frames**.

**The iframe hazard is not real on the Watch Page — verified, not assumed.** The page carries two iframes (a passive Google sign-in frame and an `about:blank`), but `#movie_player` is in the main document, `video.ownerDocument === document`, and walking up from the `<video>` to the root crosses no `IFRAME`. Drags are delivered normally; `setPointerCapture` is guarded anyway, with document-level fallbacks doing the ending.

**Two things fixed beyond the ticket's own list.** Ticket 01's carry-over: the Pane was 929px beside an 809px Player; it now follows the Player's measured box through a `ResizeObserver`, measured at **809.4px against 809.4px**. And notably, a width change now reaches `run()` at all — `content.js` compared only the action and the reason, so a width the engine changed on its own behalf (a container that narrowed under the Pane) would never have been re-applied.

**Left fragile, honestly:**

- A drag reflows the whole page. Writing the width is free (0.1ms for twelve), but the page's own recalc behind it measures **40–70ms** on a live Watch Page, so a drag tracks the pointer at roughly the page's reflow rate rather than at 60fps. This is the page's cost, not the Splitter's; making it faster would mean previewing with a transform and committing on release, which would stop the Pane reflowing live.
- The Splitter is absolutely positioned in the rail, so it scrolls with the page while the sticky Pane stays put. They sit together until the reader scrolls past the Player.
- The smoke test needs live YouTube. Three consecutive runs were green, but two earlier runs failed on the environment (one could not load the first page at all, one timed out loading the next video) with no code change between them.
- The engine's ceiling is a fraction of the **container**, which excludes the rail's 16px padding, so where the `container − 480` term binds the Player's column lands ~16px under the measured-safe width. The 60% term dominates in practice, and the frame was 707.6px at the ceiling on a 1889px container.
