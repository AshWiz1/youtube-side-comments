# 05: Survive navigation

**What to build:** Click through to another video and the layout is still correct, without a page refresh.

**Blocked by:** 01: The Comment Pane appears beside the Player; 02: Step Aside, and why

**Status:** ready-for-agent

- [ ] Navigating to another video without a page refresh leaves the layout correct on arrival.
- [ ] The previous page's arrangement is fully undone before the new page's arrangement is applied, so no step leaves the page half-arranged.
- [ ] The Comment Pane's scroll position resets for the new video, so the reader is not dropped into the middle of a thread that no longer exists.
- [ ] Navigating to a non-watch page leaves the Native Layout intact.
- [ ] Navigating repeatedly in both directions leaves no accumulated residue in the page.
- [ ] Re-applying the layout relies on an event that fires on both a cold load and an in-page navigation, so one code path covers both.
- [ ] Teardown is driven by an earlier signal than re-application, so the old arrangement is gone before the new one lands.
- [ ] The layout is applied correctly when arriving at a Watch Page that was loaded in a background tab.
