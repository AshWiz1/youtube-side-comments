# 05: Survive navigation

**What to build:** Click through to another video and the layout is still correct, without a page refresh.

**Blocked by:** 01: The Comment Pane appears beside the Player; 02: Step Aside, and why

**Status:** ready-for-agent

- [x] Navigating to another video without a page refresh leaves the layout correct on arrival.
- [x] The previous page's arrangement is fully undone before the new page's arrangement is applied, so no step leaves the page half-arranged.
- [x] The Comment Pane's scroll position resets for the new video, so the reader is not dropped into the middle of a thread that no longer exists.
- [x] Navigating to a non-watch page leaves the Native Layout intact.
- [x] Navigating repeatedly in both directions leaves no accumulated residue in the page.
- [x] Re-applying the layout relies on an event that fires on both a cold load and an in-page navigation, so one code path covers both.
- [x] Teardown is driven by an earlier signal than re-application, so the old arrangement is gone before the new one lands.
- [ ] The layout is applied correctly when arriving at a Watch Page that was loaded in a background tab.

## Comments

Navigation works. The engine, bootstrap and adapter changes are in, and run logs show the navigation tests passing: navigating to another video lands arranged without a refresh, navigating back and forth re-arranges every time with no residue, and navigating away leaves the Native Layout intact. `yt-navigate-start` now tears down before `yt-navigate-finish` re-applies, and the act/don't-act rule moved behind the seam as `needsArranging`, replacing an untested flag in the bootstrap.

**One criterion does not pass, and its box was ticked in error.** A Watch Page opened in a background tab is not arranged when the tab is shown. It was ticked before a later run exposed the failure; it is un-ticked above.

The failure is **not navigation's**. The reason recorded in the failing run is `comments-disabled`: while the tab is hidden YouTube has not yet populated the Comments, the region is therefore empty, and the settle window introduced by ticket 02 concludes there are none. This is ticket 08 occurring in the exact scenario it was filed for — a hidden tab is simply the most dependable way to be slower than a 3-second timer. The agent's own diagnosis (a resume window too short for a hidden tab) was a symptom; the cause is upstream.

This ticket's last criterion is therefore **blocked on ticket 08**, not on more navigation work.

The smoke suite is deliberately left red on that single test so the bug stays visible rather than being deleted or skipped.

**Amended after independent verification.** Two criteria's tests — "navigating repeatedly in both directions" and "navigating to a non-watch page" — are intermittently red in this environment, and both for the same verified reason rather than two: the fixture hops through a channel that now serves only children's and live videos, so `hopFromChannel` exhausts its eight landings without finding one with comments. Every landing is recorded in the failure, and each reads "Comments are turned off. Learn more" with the extension correctly declining it. The criteria are therefore not falsified, but they are only verified when the fixture can find a suitable video. That dependency is a fixture problem and is recorded on ticket 10 — it is not a defect in the navigation work.
