# 11: Pane chrome — height, Splitter affordance, bottom edge

**What to build:** Three fixes that come from using the extension in a real browser rather than from a test. Ticket 09 stays responsible for the Splitter's *behaviour* (it detaching on scroll, and a drag tracking the page's reflow rate); this ticket is its *appearance*, plus the Pane's height and its edge.

1. **The Comment Pane stops short of the Recommendation Strip**, leaving dead space beside the video description. Ticket 03 set the Pane's height to the Player's measured box; that fixed the Pane being too tall, but it now stops at the Player's bottom while the description below it runs on. The Pane should run down to the Strip.
2. **The Splitter reads as a permanent grey block** sitting on the boundary, and it covers the left edge of the Comments.
3. **The Pane has no legible bottom edge**, so where the Comments end is not visible.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## The height rule, precisely

The Pane is sticky so the Comments stay readable while the page scrolls, which caps it at the viewport. That cap and "reach the Strip" cannot both hold on a page whose description is longer than the window.

**The agreed rule: reach the Strip whenever that fits the viewport, and cap at the viewport when it does not.** So the gap disappears on ordinary pages, and the Pane never becomes taller than the window — which would put the bottom of the Comment thread below the fold and defeat the reason the Pane is sticky at all.

## Acceptance criteria

- [x] On a page whose description fits the viewport, the Comment Pane reaches the Recommendation Strip — no dead space beside the description.
- [x] The Pane never becomes taller than the viewport.
- [x] The Splitter is not visible at rest.
- [x] The Splitter covers no part of the Comments — no text or control underneath it.
- [x] The Splitter stays discoverable: hovering or focusing makes it apparent, and its grab area remains comfortably large even though it is thin.
- [x] Keyboard focus on the Splitter is obvious.
- [x] The Comment Pane's bottom edge is legible, so where it ends can be seen.
- [x] Dragging, clamping, the keyboard step, double-click reset and width persistence are all unregressed, including under ticket 03's real-pointer-input smoke tests.
