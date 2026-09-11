# 08: Comments-disabled is concluded on a timer

**What to build:** A Watch Page whose comments have genuinely been turned off should Step Aside for that reason — while a page that is merely *slow* should not be mistaken for one.

This is a defect found while implementing ticket 02, not new scope. YouTube renders the Comments region on **every** Watch Page, empty, for roughly a second before it reveals whether there are any comments (measured: region present but empty at 2.5s, filled and carrying its marker at 3.6s). An empty region is therefore also the *young* state. Ticket 02 concludes `comments-disabled` after a 3-second settle window, so a watch response slower than that — a slow connection — has an ordinary video judged commentless, and the extension stays Stepped Aside until the next lifecycle event. The user-visible symptom is the Comment Pane simply not appearing on a slow connection, which is this category's signature failure arriving by a new route.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A slow Watch Page load is not misreported as having comments disabled.
- [ ] A video whose comments are genuinely turned off still Steps Aside, with that reason recorded.
- [ ] The fix does not rest on a wall-clock threshold tuned to one machine's network speed.
- [ ] No empty Comment Pane is left behind, and no notice of YouTube's is relocated into the Pane.
