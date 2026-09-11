# 03: The Splitter

**What to build:** Drag the vertical divider between the Player and the Comment Pane and the Pane resizes to follow. The width stops at sensible limits on both sides, survives navigation and restarts, and the Player stays correctly sized throughout. This is the feature the whole project is differentiated by, so it is the one thing not to compromise on.

**Blocked by:** 01: The Comment Pane appears beside the Player

**Status:** ready-for-agent

- [ ] Dragging the Splitter resizes the Comment Pane continuously, following the pointer.
- [ ] The Comment Pane stops shrinking at a floor that keeps it readable, and the Player stops shrinking at a width that keeps it usable.
- [ ] The Pane's default width matches the width of YouTube's own right rail, so the Pane occupies exactly the space the Recommendation Strip vacated.
- [ ] The width ceiling is the lesser of a proportion of the container and the container minus the measured-safe player minimum, keeping the layout out of widths that were never measured.
- [ ] The Player's column and its chain of ancestors have their minimum width overridden, so that YouTube's own floor does not silently cap the drag before it reaches the ceiling.
- [ ] After every width change the Player's video element and control bar match the Player's actual size, with no overflow beyond its frame.
- [ ] The resize notification dispatched after a width change is debounced during a drag so that dragging stays smooth.
- [ ] Double-clicking the Splitter restores the default width.
- [ ] The Splitter is focusable and moves with the arrow keys.
- [ ] The Splitter is exposed to assistive technology as a separator between the Player and the Comment Pane.
- [ ] Dragging does not select page text, and the cursor stays a resize cursor for the whole gesture.
- [ ] The chosen width persists across navigation and browser restarts as a single global preference, not a per-video one.
- [ ] Pointer and keyboard input resolve a width through the same clamping logic, so the two paths cannot disagree.
