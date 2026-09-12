# 08: Comments-disabled is concluded on a timer

**What to build:** A Watch Page whose comments have genuinely been turned off should Step Aside for that reason — while a page that is merely *slow* should not be mistaken for one.

This is a defect found while implementing ticket 02, not new scope. YouTube renders the Comments region on **every** Watch Page, empty, for roughly a second before it reveals whether there are any comments (measured: region present but empty at 2.5s, filled and carrying its marker at 3.6s). An empty region is therefore also the *young* state. Ticket 02 concludes `comments-disabled` after a 3-second settle window, so a watch response slower than that — a slow connection — has an ordinary video judged commentless, and the extension stays Stepped Aside until the next lifecycle event. The user-visible symptom is the Comment Pane simply not appearing on a slow connection, which is this category's signature failure arriving by a new route.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] A slow Watch Page load is not misreported as having comments disabled.
- [x] A video whose comments are genuinely turned off still Steps Aside, with that reason recorded.
- [x] The fix does not rest on a wall-clock threshold tuned to one machine's network speed.
- [x] No empty Comment Pane is left behind, and no notice of YouTube's is relocated into the Pane.

## Comments

**This ticket now blocks ticket 05's last acceptance criterion**, and that is how it was found to be real rather than theoretical.

Ticket 05's background-tab test fails with the recorded reason `comments-disabled`. While a tab is hidden, YouTube has not populated the Comments; the region is empty; the settle window expires and concludes there are none. A background tab is simply the most dependable way to be slower than a 3-second timer — which is exactly the failure this ticket describes, reached through the scenario it was filed for.

The fix therefore unblocks a user-visible criterion as well as removing a latent one: a Watch Page opened in a background tab should be arranged when the tab is shown.

## Comments

**Resolved, and reviewed independently rather than taken on report.** The settle window is gone entirely: `COMMENTS_SETTLE_MS`, `blankSince` and `RESPONSE_HAS_COMMENTS` are deleted (verified by grep — the only `setTimeout` left in `src/` is the bootstrap's retry, which is not a settle window). The decision now reads YouTube's own markers.

Two claims were checked before these boxes were ticked:

- **Why no clock can participate.** Measured first: `#comments` is a hidden, empty lazy-upgrade placeholder before YouTube builds it, and upgrades to hold the section renderer and header after. That placeholder is the *young* signal, so `page.commentsState` is a tri-state — `PENDING` Steps Aside through `unrecognised-structure`, which the bootstrap retries and never treats as terminal; `NONE` is a genuinely commentless video; `READY` arranges. A page can be young for minutes and stays `PENDING` throughout.
- **Why the slow case is covered.** The background-tab smoke test *is* the slow case — a hidden tab is the most dependable way to be slower than any threshold — and it passes.

`response-has-comments` was deleted after measurement showed YouTube sets it for commented and comment-off videos alike, so it never discriminated. A genuinely commentless video was verified against a real one (a "made for kids" upload found through YouTube's API): the reason is `comments-disabled`, no Pane appears, and YouTube's own "Comments are turned off" notice is left in place rather than relocated into an empty Pane.

The agent also fixed a real bug in the harness: `poll()` evaluated every expression in the *foreground* page, so the background test's "wait for the tab to be shown" was vacuous and its `threads > 0` assertion was a race. That makes the test stronger, not looser.

**Residual, accepted:** if YouTube's answer arrives after the retry window *and* the region is replaced in a way the observer cannot see, the page stays Stepped Aside with `unrecognised-structure` until the next event. No misreport — but not arranged either. `COMMENTS_SECTION` is also a belief about YouTube's markup; a redesign rendering a comment section without a header renderer or threads would read as `NONE`, whose failure mode is a missing Pane rather than an empty one.
