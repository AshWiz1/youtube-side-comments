# 09: Splitter refinements

**What to build:** Three rough edges left behind by ticket 03, all in the Splitter — the feature this project is differentiated by, so they are worth closing rather than living with.

1. **The Splitter and the Comment Pane part company on scroll.** The Splitter is absolutely positioned in the rail, so it scrolls with the page while the sticky Pane stays put. A reader who has scrolled into the Comments can see the Pane but cannot resize it without scrolling back — which is the moment they are most likely to want to.
2. **A drag tracks the page's reflow rate, not the pointer's.** Writing the width is nearly free, but the page's own recalc behind it measures 40–70ms on a live Watch Page, so the Pane reflows live on every pointer move and the drag moves at roughly the page's rate rather than the display's.
3. **The ceiling lands about 16px inside the unmeasured band.** The engine's ceiling is a fraction of the container, which excludes the rail's 16px padding, so where the `container − player minimum` term binds, the Player's column ends up slightly narrower than the measured-safe width. The proportional term dominates in practice.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The Splitter and the Comment Pane stay together when the reader scrolls into the Comments.
- [ ] A drag follows the pointer at the display's refresh rate rather than the page's reflow rate — or the cost is shown not to be the Splitter's to pay.
- [ ] Where the `container − player minimum` term sets the ceiling, the Player's column stays at or above the measured-safe width.
- [ ] No regression in the drag, clamp, keyboard, reset or persistence behaviour ticket 03 verified, including its real-pointer-input smoke tests.

## Comments

**A finding from ticket 11 that belongs here.** Measured while fixing the Comment Pane's height: the Pane does not actually stick. `#secondary-inner` is exactly as tall as the Pane, so `position: sticky` has no travel — at scroll offsets 0 / 300 / 1200 the Pane's top tracks the Player's exactly (68 → −232 → −1132).

The Pane therefore behaves as a fixed-height column rather than a pinned one: scrolling the *page* takes it away, and only the Pane's own scrollbar keeps the Comments readable. That is survivable while the Pane fills the window, which is now most of the time, but it is why the viewport cap's stated benefit cannot currently arise — and it is the same problem as the Splitter parting company with the Pane on scroll, already in this ticket. Fixing stickiness would fix both.
