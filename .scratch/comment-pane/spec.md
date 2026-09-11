# Comment Pane — Spec

Status: ready-for-agent
Feature: `.scratch/comment-pane/`

## Problem Statement

On YouTube's Watch Page the Comments sit below the Player. On a normal desktop viewport the Player fills the top of the page and the Comments begin below the fold, so a viewer has to choose between watching and reading: scroll down to read Comments and the video scrolls out of view, scroll back up to watch and lose your place in the thread. The two things you most want to do at once are the two things the layout prevents.

Meanwhile the Recommendation Strip occupies the right rail — a full column of screen given to content that only matters after the video ends, idle for the entire time you're actually watching.

## Solution

The Comments are relocated into a **Comment Pane** docked to the right of the Player, sharing its height, with a draggable **Splitter** between them. Reading the thread scrolls the Pane alone; the Player never moves. The **Recommendation Strip** moves out of the right rail into a full-width region below the Player and the Pane, so the reserved column disappears and the video's own metadata (title, channel, actions, description) stays exactly where YouTube puts it.

When the layout doesn't fit or can't be built — theater mode, fullscreen, Shorts, live chat, a narrow window, an open YouTube panel, comments disabled, or a page that no longer matches expectations — the extension **Steps Aside** and leaves the Native Layout completely untouched, recording why so the popup can say so.

## User Stories

### Watching and reading

1. As a viewer, I want the Comments beside the Player, so that I can read comments and watch the video at the same time.
2. As a viewer, I want the Comments to be YouTube's real comments, so that replies, sorting, likes and the composer all keep working exactly as they do today.
3. As a viewer, I want the Comment Pane to scroll independently, so that reading further down a thread never moves the Player.
4. As a viewer, I want the Pane to remain in view while I read, so that the video keeps playing somewhere I can see it.
5. As a viewer, I want the video's title, channel row, action buttons and description to stay where they are, so that the page still reads as YouTube.
6. As a viewer, I want to be able to post a comment from the Pane, so that reading and replying happen in the same place.

### The Recommendation Strip

7. As a viewer, I want the Recommendation Strip below the video rather than beside it, so that it stops occupying a column I'm not using while watching.
8. As a viewer, I want the Recommendation Strip laid out for the width it now has, so that it doesn't read as a single stretched column of thumbnails.
9. As a viewer, I want the space the old right rail occupied to be reclaimed, so that the page isn't left with a dead column.

### Resizing

10. As a viewer, I want to drag the Splitter to set the Pane's width, so that I can give more room to whichever side I'm attending to.
11. As a viewer, I want the Pane to stop shrinking at a readable minimum, so that a careless drag can't leave me with an unusable column.
12. As a viewer, I want the Player to stop shrinking at a usable minimum, so that dragging the Splitter can't destroy the video.
13. As a viewer, I want to reset the width after dragging it somewhere unhelpful, so that I can get back to a sane layout without guessing.
14. As a viewer, I want my width remembered between videos, so that I don't re-drag on every page.
15. As a viewer, I want that width remembered as a single global preference, so that it behaves like a setting rather than a per-video chore.
16. As a keyboard user, I want the Splitter to be focusable and to respond to arrow keys, so that resizing isn't mouse-only.
17. As a screen reader user, I want the Splitter to be announced as a separator between the Player and the Comment Pane, so that I know what it is and what it does.
18. As a viewer, I want dragging not to select page text or flicker the cursor, so that resizing feels deliberate rather than broken.

### Navigation

19. As a viewer, I want the layout to re-apply when I navigate to another video, so that it works without a page refresh.
20. As a viewer, I want the Pane to start at the top on each new video, so that I'm not dropped into the middle of a thread that no longer exists.
21. As a viewer, I want the old layout to be fully undone before a new page's layout is applied, so that navigating never leaves the page half-arranged.

### Stepping Aside

22. As a viewer, I want the extension to do nothing in theater mode, so that YouTube's own behavior is preserved where this layout doesn't fit.
23. As a viewer, I want it to do nothing in fullscreen, so that the video is never obstructed.
24. As a viewer, I want it to do nothing on Shorts, so that an unrelated page is left completely alone.
25. As a viewer, I want it to step aside on live streams and premieres, so that I never displace a live chat.
26. As a viewer, I want it to step aside when the window is too narrow for two columns, so that I get a working layout instead of a cramped one.
27. As a viewer, I want it to step aside when YouTube itself has collapsed to a single column, so that the Comments can never silently disappear.
28. As a viewer, I want it to step aside while a YouTube panel such as the transcript is open, so that those features keep working.
29. As a viewer, I want it to step aside on a video where comments are disabled, so that I'm not shown an empty column.
30. As a viewer, I want it to step aside when the page no longer matches what it expects, so that a YouTube change degrades to normal YouTube rather than a broken page.
31. As a viewer, I want stepping aside to be a clean, complete revert, so that "not running" and "ran and undid itself" look identical.

### Control and transparency

32. As a viewer, I want a way to turn the layout off for the current page, so that I'm not stuck with it when I don't want it.
33. As a viewer, I want a way to turn it off everywhere, so that whether it runs at all is my choice.
34. As a viewer, I want to see whether the Pane is currently active, so that I can tell at a glance what state I'm in.
35. As a viewer, I want to be told *why* it stepped aside, so that I can distinguish "deliberately off" from "broken."
36. As a viewer, I want an automatic step-aside to affect only the page that tripped it, so that one bad video doesn't disable the extension across YouTube.

### Reliability

37. As a viewer, I want the Comments to load on their own when the Pane appears, so that I'm not staring at an empty box.
38. As a viewer, I want the video and its controls to stay correctly sized after I resize, so that the Player is never left overflowing its own frame.
39. As a viewer, I want it to keep working on a radio playlist, so that another element occupying the right rail doesn't break the layout.
40. As a viewer, I want it to keep working across YouTube's experiments with the watch page, so that I'm not silently dropped back to the old layout without explanation.
41. As a viewer, I want the extension to send nothing anywhere and collect nothing about me, so that my viewing isn't reported to anyone.

## Implementation Decisions

### Modules

- **Layout Engine** — pure decision logic. Takes a plain description of page state and returns either an arrangement to apply or a decision to Step Aside with a reason. Contains every product rule: the default width, the clamps, and every Step Aside trigger. Performs no DOM reads, no DOM writes, and holds no browser state.
- **DOM Adapter** — the impure edge. Reads the page's elements and derives the state description the Layout Engine consumes; applies the engine's arrangement to the real DOM; observes navigation and mode changes; reverts cleanly when stepping aside.
- **Splitter** — pointer and keyboard input for the divider. Converts a pointer position to a requested width, delegates all clamping to the Layout Engine, and dispatches the resulting width change.
- **Storage** — the persisted pane width and global enabled flag.
- **Popup** — the toolbar surface: global on/off, reset width, and the current status including the step-aside reason.

### Layout Engine interface

The engine is the single testing seam, so its shape is a decision in its own right:

```
decide({ viewport, page, prefs }) → { action, reason?, paneWidth?, placement? }

viewport: { width }
page:     { hasComments, hasRelated, isSingleColumn, isTheater, isFullscreen,
            hasLiveChat, hasOpenPanel, hasPlaylist, commentsDisabled, isShorts,
            isWatchPage, structureRecognised }
prefs:    { enabled, paneWidth }

action:   'apply' | 'stepAside'
reason:   a stable identifier naming the step-aside cause, for the popup to render
paneWidth: the resolved width, after clamping
placement: where each relocated region belongs
```

`reason` is a stable identifier rather than a message so the popup owns presentation.

### Relocating the Comments

- The Comments are relocated by **reparenting YouTube's own live comment element**, not by rebuilding the thread against YouTube's internal API. This keeps replies, sorting, likes, pagination, and the composer working without reimplementation.
- The correct element is the comments node **carrying the `#comments` id** — the tag name alone matches a second, hidden element, and selecting on the tag alone would pick the wrong one.
- The element sits behind an extra wrapper element between it and the region that holds the video's metadata. Restoring the Comments to the wrong depth is a real bug shipped by prior art; the Adapter must restore to the exact original position.
- The Comment Pane is hosted inside YouTube's existing right-rail container. This is deliberate: the container also holds YouTube's panels and playlist panel, and hosting outside it would break transcripts and playlists. The container's width and flex basis are overridden with high-specificity rules driven by our own custom property, rather than by fighting YouTube's inline width variable, which YouTube rewrites.
- Publishing the Recommendation Strip's former region as empty is avoided by reclaiming it; the layout does not leave a dead column.

### Player sizing

- YouTube's aspect-ratio box is pure CSS and self-corrects; no intervention is needed for the container geometry.
- However, the player's **internals do not self-correct**: the video element and the control bar carry inline pixel dimensions written by YouTube's script, refreshed on window resize, and YouTube attaches no resize observer to the player. After a width change they overflow the shrunken player by hundreds of pixels.
- Therefore the Adapter dispatches a synthetic window resize event after every width change. During a drag this is debounced to an animation frame. This is load-bearing, not a workaround.
- YouTube imposes an **853px minimum width** on the player's column via custom-property-derived `min-width` rules. This would silently cap the Splitter before it reached the configured maximum. Overriding `min-width` to zero on the player column and its chain of ancestors is **mandatory**, not optional; without it the drag range is wrong.
- Sweeps with that override held a clean 16:9 at every width tested down to 480px, with no clamping and no residue when the override was removed.

### Width rules

- Default width: **402px**, matching the width of YouTube's own right rail, so the Pane occupies exactly the space the Recommendation Strip vacated.
- Floor: **320px**. This is not arbitrary — it is the same minimum YouTube applies to that column.
- Ceiling: **the lesser of 60% of the container and the container minus 480px.** The second term exists because player widths below 480px were never measured, and this clamp keeps the layout out of unmeasured territory. It binds only marginally in practice.
- Reset gesture: double-click the Splitter. Keyboard: arrow keys on the focused Splitter.
- The width is one global preference, persisted locally. It is not per-video.

### Stepping Aside

- There is **one** step-aside code path, serving every trigger: the manual toggle, every mode exclusion, and automatic failure.
- Triggers: not a watch page; theater mode; fullscreen; Shorts; a live chat present; YouTube's own single-column state; an open YouTube panel; comments disabled; an unrecognised page structure; or a viewport too narrow for two columns.
- **The single-column trigger reads YouTube's own signal rather than a viewport-width threshold we choose.** YouTube collapses to one column and hides the right rail at its own breakpoint — observed at a 1000px viewport, above the 900px threshold originally assumed. A hardcoded number would have applied our layout inside a container YouTube had already hidden, which is precisely the "comments silently don't appear" failure that defines this category. Reading YouTube's signal is exact and self-maintaining.
- Theater mode is detected from a persisted attribute, so it must be checked at load and not only on toggle.
- Fullscreen is detected from the document's fullscreen element, not from an attribute.
- Any panel-opening flag can appear in future; the guard watches for YouTube's horizontally-docking panel modes specifically, since those genuinely compete for width.
- The **fallback is two-tier only**: our layout, then Native Layout. YouTube's own comments engagement panel is deliberately *not* used as a middle tier — it is player-attached and does not behave like the Comment Pane, so silently showing it would substitute a different product.

### Page structure

- The Adapter selects on **element structure and ids, not on custom-element tag names.** YouTube has parallel watch-page roots in circulation with structurally identical internals; matching on the familiar tag alone would silently no-op for anyone in an experiment. `structureRecognised` in the engine's state exists so that an unrecognised root Steps Aside loudly rather than failing quietly.
- The Adapter must tolerate another element occupying the right rail (a playlist panel on radio playlists) without breaking.

### Comment loading

- The Comments are fetched by YouTube only once their element has a real, non-zero layout box intersecting the viewport. The Adapter therefore must never leave the Pane in a state where the Comments cannot load.
- If the Pane must be hidden without being reverted, it is hidden with a technique that **preserves a layout box** rather than removing it from layout — a hidden-by-removal pane leaves the Comments cold, so revealing it shows a spinner where the thread should be. Techniques that collapse or move the element off-screen were measured to go cold.

### Lifecycle

- Navigation is detected from the event that fires on **both** cold load and in-page navigation; a second, earlier event is used for teardown so the previous page's arrangement is undone before the new one is applied.
- On navigation, the Pane's scroll position resets, since it holds a different thread.

### Storage and privacy

- One local preference store: pane width and the global enabled flag.
- No network requests, no remote configuration, no telemetry, no analytics. The extension talks to nothing.

## Testing Decisions

**What makes a good test here.** Tests assert *external behavior at the module boundary* — state in, decision out — and never inspect internals. A test that has to know how the engine is structured, or which helper it called, is testing the wrong thing. Test names use the project glossary's vocabulary (Comment Pane, Recommendation Strip, Splitter, Step Aside, Native Layout), not synonyms.

**The seam.** Exactly one code seam: **the Layout Engine's public interface.** Plain data in, plain data out. No DOM, no browser, no headless environment — the engine's inputs are object literals and its outputs are object literals. This is the highest seam available, and it carries every product rule we have: the default width, both clamps, all ten step-aside triggers, the two-tier fallback, and the reason identifier the popup renders.

**What this buys.** The combinations that are painful or impossible to reach in a browser become trivial — theater mode entered while the Pane was already applied; a radio playlist occupying the right rail; comments disabled on a video that is otherwise eligible; a viewport that is narrow *and* has a live chat. These are the cases where layout bugs actually live, and behind a pure interface they're ordinary unit tests.

**Modules tested by unit tests.** The Layout Engine only. Exhaustive coverage of its state space: every trigger independently, plus the overlaps, plus the boundary values of both clamps and the default.

**Explicitly rejected: jsdom fixtures of YouTube's page.** An earlier plan called for testing against saved snapshots of YouTube's DOM. That is dropped deliberately. A fixture is a frozen *belief* about YouTube's structure — it would have encoded the extra wrapper element and the CSS variables that no longer exist, and then passed happily while reality diverged. It tests our assumptions back to us. The decision logic belongs in pure-function tests, and the DOM reading belongs against the real thing.

**End-to-end testing.** A headless-browser smoke test drives a real browser against a real Watch Page and asserts the end-to-end outcome: the Comment Pane exists, the Comments loaded, the Player's video element matches its container, the Recommendation Strip moved, and teardown restores the original arrangement. It runs with a **fresh browser profile every time** — reusing one silently carries over player state including theater mode, which produces false failures and made an earlier research run drift between passes.

**Boundary of the two.** Everything impure — reading the page, reparenting, pointer handling, the popup — is covered by the smoke test rather than unit tests. That is the intended trade: keep the impure layer small enough that a smoke test suffices, and put the decisions where they can be enumerated.

**Prior art for the tests.** None — this repo is greenfield and these are its first tests. They establish the pattern: a pure engine with table-driven cases, plus one end-to-end smoke test.

## Out of Scope

- **Theater mode, fullscreen, Shorts, live streams, premieres.** The extension Steps Aside on all of them and leaves Native Layout intact.
- **`m.youtube.com`, embedded players, `music.youtube.com`.** The extension is scoped to the desktop watch page only.
- **The autoplay "up next" overlay.** It belongs to the Player and is left untouched.
- **YouTube's own comments engagement panel.** Existing, acknowledged, and deliberately unused — neither as a feature nor as a fallback tier.
- **Restyling.** YouTube's comments, the video metadata, and the Recommendation Strip keep their own appearance; only their position and container width change.
- **Publishing to the Chrome Web Store.** The extension is distributed unpacked.
- **Firefox and other non-Chromium browsers.**
- **Per-video width preferences.** One global width, deliberately.
- **Player widths between 320px and 479px.** Unmeasured in research, and the width ceiling is set to keep the layout out of that band.
- **Behaviour when more than one of the excluded modes applies at once.** The reason reported is simply the first trigger that matches.

## Further Notes

**Research basis.** Every structural claim above comes from live instrumentation on 2026-09-11 — headless Chrome 152 driving real Watch Pages, with controlled A/B experiments on reparenting, width sweeps, and event ordering — not from documentation or inference. Two claims in the original design were corrected by that work and are recorded here as corrections: the player's sizing needed a resize dispatch after all (with a different mechanism than first assumed), and the ~900px narrow-viewport threshold was wrong in a way that would have caused the category's signature failure.

**The target moves.** YouTube's DOM changes, and this category's history is a catalogue of extensions breaking quietly on layout changes. Two named reasons to expect churn: CSS variables that existed two years ago no longer exist, and a family of feature-flagged layout modes sit dormant in YouTube's stylesheets that can reflow the columns without warning. The `structureRecognised` state and the universal dependence on Step Aside are the mitigations.

**Prior art worth reading.** An archived MIT-licensed extension implements a very similar layout including a draggable divider; it is the closest thing to this spec that exists, and its issue tracker is a ready-made list of failure modes. A maintained MIT-licensed sibling reparents into the same container and provided the width-override technique and confirmation that the resize dispatch is load-bearing. Both should be consulted before writing the Adapter, and neither should be copied wholesale.

**The differentiator is the Splitter.** Research into the competitive field found the draggable divider repeatedly requested and essentially never shipped: the category leader has resizable panels sitting in its unmet-request backlog, and a popular sibling's top critical review asks for exactly this and points at the archived extension as the thing to copy. This is the one feature the spec should not compromise on.

**Explicitly not recorded.** No ADR covers the decision to reparent YouTube's DOM rather than rebuild the UI; the reasoning lives in this spec's Implementation Decisions instead.
