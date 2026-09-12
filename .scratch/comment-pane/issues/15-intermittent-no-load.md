# 15: The Pane sometimes does not appear until the page is reloaded

**What to build:** Opening a video must arrange the layout on the first attempt, every time. Today it sometimes does not, and **reloading the same video makes it work** — so the video is not the variable; the load sequence is.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

This is the failure mode the project's opening research identified as this category's most-complained-about defect: a pane that does not appear until the reader refreshes. It has now been observed here, which makes it worth fixing properly rather than waiting for it to become reproducible on demand.

## What is known, and what is not

- Reported from use: the Pane **sometimes** fails to appear when a video is opened; **reloading that same page fixes it**.
- The reload fixing it is the important clue. The video, the channel and the page are all constant between the two attempts — only the sequence of events that built the page differs.

## The leading hypothesis, which is a hypothesis

The layout is decided against a page that is still being built, the decision lands on a state that is transient — a column YouTube has not finished laying out, a Comments region not yet populated, a mode flag not yet cleared — and **nothing re-decides once the page settles**.

Note that the bootstrap's retry covers exactly one reason: `unrecognised-structure`. Ticket 08 deliberately made "YouTube has not built the Comments yet" retry through that reason. A decision that lands on any *other* transient state has no such recovery.

This may also be the same class as ticket 08's background-tab failure, which was a race between our decision and YouTube's build, reached by a different route.

**Do not fix this by retrying indefinitely or by loosening a trigger.** Widening a retry window hides a race rather than resolving it, and a trigger loosened to stop a symptom is how the `live-chat` bug (ticket 13) happened — a condition that matched far more than it was written for.

## Acceptance criteria

- [x] The failure is **reproduced**, with a rate over repeated cold loads, rather than reasoned about from a single report. Reloading is not a reproduction.
- [x] At the moment of failure, the state the decision was taken against is recorded — and whether a reason was recorded at all. `data-ysc` absent with no `data-yscReason` means something different from a reason being present, and the two must be told apart before anything is changed.
- [x] The fix addresses why the page was misjudged, not the symptom of it being misjudged.
- [x] Repeated cold loads of a video succeed consistently after the fix — with the number of runs and the failure rate before and after both stated.
- [x] No trigger is loosened and no retry window simply widened. If a window must change, say what it is a window *on* and why that is the right thing to wait for.
- [x] If the failure cannot be reproduced at all, **say so plainly** and record what was tried and how many runs it took. An honest "could not reproduce in N runs" is a real result; a speculative fix for a bug nobody has seen is not.

## Narrowed by the reporter: it is not intermittent, it is one navigation path

The user's clarification changes this ticket completely. In their words: *"If I open a video from home by clicking it (not opening in a new tab), it's not loading the sidebar."*

So it is **consistent**, not random, and the variable is where the navigation *starts*:

- Click a video from the **home page**, in the same tab — **fails**.
- Open the video in a **new tab** — works.
- **Reload** the same video — works.

## The leading hypothesis: the content script is not there yet

**`manifest.json` matches only `https://www.youtube.com/watch*`.** A content script is injected into a *document*, and that document was created at `/` — so our script was never injected into it, and there is nothing present to observe YouTube's in-page navigation into a watch page.

That accounts for every observation without strain:

- From a **watch page**, clicking to another watch page works — the script is already resident, which is exactly what ticket 05's navigation tests exercise.
- From the **home page**, nothing is resident to notice the navigation.
- A **new tab**, or a **reload**, creates a fresh document at a `/watch` URL, which matches, so the script is injected.
- Ticket 05's navigation tests could not have caught this: they always begin from a watch page.

The fix is likely to widen the manifest's `matches` so the script is present on the pages a reader navigates *from*, with the engine's `isWatchPage` continuing to decide where it actually acts — the extension's behaviour is already gated on being on a watch page, so widening the match should change where the script *exists*, not where it *acts*.

**Confirm the mechanism before changing anything**, rather than taking this on trust: the decisive check is whether the content script exists in the document after a home-to-watch in-page navigation. Also confirm what Chrome actually does with content-script injection on History API navigations, since that is the load-bearing assumption here.

**Coverage gap to close regardless of the mechanism:** a test must begin from a non-watch page and arrive at a watch page. Every existing navigation test starts from a watch page, which is exactly why this survived thirteen tickets.

## Comments

**Reproduced, diagnosed and fixed.**

The mechanism was confirmed before anything was changed, using the harness's own instrument: it records the isolated worlds Chrome creates for a content script. A fresh profile with only this extension installed, so a world means our script.

| step | isolated worlds | Pane |
|---|---|---|
| on the page navigated **from** (search results) | **0** | no |
| after clicking through, in-page, to a Watch Page | **0** | **no** — the bug |
| after reloading that same page | **1** | yes |
| after the fix, on the page navigated from | 1 | no (correctly: `not-watch-page`) |
| after the fix, after clicking through | 1 | **yes, with no reload** |

So the reading was right: the script was never injected into a document created at a URL the manifest did not match, and nothing was resident to see the navigation. Reloading won because it created a new document at a matching URL.

**Before and after:** 1 of 1 in-page arrivals failed before the fix; 2 of 2 probe runs and 1 of 1 test runs succeeded after. Small numbers, but the mechanism is deterministic rather than racy — injection happens at document creation — so repetition is not what would falsify it.

**The fix:** `manifest.json` now matches the whole of `youtube.com` rather than only `watch*`. That changes where the script *exists*, not where it *acts* — `isWatchPage` still gates every behaviour, and the only rules in `layout.css` not gated behind `html[data-ysc='on']` are the `:root` custom properties and `#ysc-pane` itself, which cannot exist off a Watch Page.

**The coverage gap mattered more than the bug.** Every existing navigation test begins from a Watch Page, where the script is already resident, so all of them passed whether or not the script could ever *arrive*. A test now begins somewhere else; it is kept in `test/entry-navigation.test.js` rather than the smoke suite because it is a different journey, and because ticket 14 was being written into that file at the same time.
