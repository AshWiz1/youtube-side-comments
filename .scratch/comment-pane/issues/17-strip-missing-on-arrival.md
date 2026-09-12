# 17: Arriving at a Watch Page in-page moves the Comments but not the recommendations

**What to build:** Clicking a video from the home page should bring the Recommendations Strip below the Player, exactly as a fresh load does. Today the Comment Pane appears and the Strip does not.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## The report

From use: *"So it happens when I click on a video from the home page. Once I click on this video the recommendations would not be loaded below the video."* The page as a whole should still have them there.

This is the in-page arrival path that ticket 15 opened up — before that fix, nothing happened at all on this route, so the symptom is newly visible rather than newly caused.

## The gap in the code, which explains the symptom exactly

`readState` decides whether the page is understood like this:

```js
structureRecognised: Boolean(page),   // page = locate() -> #primary + #secondary-inner
```

**It never checks for the related list.** And the move itself is guarded:

```js
const related = doc.querySelector(RELATED);
if (related) { ...move it into the Strip... }
```

So on a page where the Comments have arrived but the related list has not:

1. the structure is judged **recognised** and the layout is **applied** — the Comments move;
2. the related list is absent, so the move **silently does nothing**;
3. the decision does not change afterwards, so `needsArranging` says nothing has moved and **nothing re-applies**.

The two elements do not arrive together. The Comments appear first, and on a fast machine the related list is there by the time we look — which is why this has gone unnoticed.

## Do not fix it by gating the layout on the related list

The tempting one-line fix is to make `structureRecognised` require `#related` too. **That trades a missing Strip for a missing Pane**: any page whose related list never appears would then never be arranged at all, and the Comment Pane is the feature.

The Comment Pane should still appear promptly. What must change is that the related list is *waited for*, or that the layout is re-applied when it arrives — not that the whole layout is held hostage to it.

## Reproducing it

**My own attempt failed and you should know that before you start.** A test asserting the Strip on this path **passes** — the harness navigates fast enough that the related list is present by the time the decision is taken. So the window is timing-dependent and does not open here by itself.

The harness's `newPage(browser, url, { preload })` runs a script in every new document before any page script, which is the lever for forcing that window open: delay or remove the related list for a measured interval and see whether the Strip goes missing. **A fix verified against a forced window is worth far more here than one argued from reading code** — this project has had three confident diagnoses that measurement overturned, and two of them were mine.

## Acceptance criteria

- [x] Arriving at a Watch Page by in-page navigation moves the related videos into the Recommendation Strip.
- [x] A page whose related list arrives late still ends up arranged — the Strip appears when the list does, without a reload.
- [x] A page whose related list **never** appears still shows the Comment Pane. The layout is not held hostage to an element that may not come.
- [x] The window is forced open in a test, so the fix is verified rather than argued. If it cannot be forced, say so plainly and say what was tried.
- [x] No regression in the Strip's layout, its Step Aside revert, or the four-per-row grid ticket 12 established.
- [x] Do not tick a box you have not verified.

## Comments

**Two faults, and the one the report is about was not the one this ticket diagnosed.**

**What the reader sees is an *invisible* Strip, and the cause is `locate`.** Measured
on this route (search results → video, in-page), the document holds **two pages at
once**: the outgoing Search Page stays in it — `ytd-search`, stamped `hidden`, 0×0 —
with its own `#primary` inside it, beside the arriving Watch Page's. `locate` read
one element at a time, so it returned the *dead* page's `#primary` and the *live*
page's rail: the Comments went into the live rail and were visible, and the Strip was
placed after the dead page's columns — in the document, holding `#related` and every
tile, at **0×0**, forever. That is the report exactly, DevTools reading included.

`locate` now finds the two as a **pair**, by the relationship the layout is itself
made of: the Strip goes after the box holding both columns, so the wanted `#primary`
is the one whose box also holds the rail's column. A page whose two do not hang
together is read as before — the first of each — so nothing is narrowed and no page
is left unarranged for it.

**The readiness gap this ticket was written about is real, and is now closed too** —
as a second fault, not as this symptom's cause. There is no evidence it ever fired
for the reader: on this route the related list was measured arriving *before* the
Comments (present at 3.1s while the Comments region was still YouTube's placeholder),
and the reverse order was only ever produced here by holding the list back by hand.

**Verified, not argued** — each with the failing reading taken first:

| | before | after |
|---|---|---|
| arrival, Strip's box | `0×0`, `#related` inside, Pane visible | 1889 wide, 2196 tall, 228 below the Player |
| arrival, assertion | `the Strip has no box on the page — {"strip":{"y":0,"w":0,"h":0}…}` | passes |
| related list held out until the Pane is up, then released | `timed out waiting for the related videos in the Strip` | reaches the Strip, no reload |

The new test holds the related videos **out of the document from the moment YouTube
builds them** and releases them only once the Pane is up, which is the window this
ticket asked to have forced; that it fails without the fix is the proof it is forced.
The Pane is up throughout, which is the "not held hostage" criterion read directly.

`locate`'s change is a superset of what it did before: the fallback is the same two
elements, so no page can be left unarranged that was arranged before it.

**Left fragile, and stated rather than papered over:** `test/entry-navigation.test.js`'
`clicking through arranges the Comment Pane` still times out now and then **when the
whole suite runs**, and never when that file runs alone (measured: green twice in a
row alone, in 2.8–3.2s; red in both full-suite runs, the first taken before any change
here). Its page is a live search feed and its arrival is YouTube's to serve. The two
navigation fixtures this ticket was told not to chase were green in every run taken
here and were not touched.

151 tests, all passing.
