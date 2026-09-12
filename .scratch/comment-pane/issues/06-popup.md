# 06: The toggle, in the Pane rather than the toolbar

**What to build:** A control in the Comment Pane that returns the page to the Native Layout, so leaving the side-comments layout does not mean going to the browser toolbar. This replaces the original plan for this ticket, which was a toolbar popup: the user used the extension and asked for the control to live in the Pane, where they are already looking.

**Blocked by:** 02: Step Aside, and why; 03: The Splitter

**Status:** ready-for-agent

## The consequence the first draft of this ticket missed

An earlier version of this ticket asked that "the same control brings the layout back". That is impossible as written, and worth recording so nobody re-adds it: **turning the layout off removes the Comment Pane, and the control lives in the Pane.** The control cannot survive its own action.

So the two directions have different homes, which is the honest shape of the request rather than a compromise:

- **The in-page control turns the layout off.** That is the moment the reader is looking at the Pane and wants it gone, and they should not have to leave the page to say so.
- **The toolbar surface turns it back on**, and carries the Step Aside reason.

This is what makes the toolbar surface load-bearing rather than decorative: without it, turning the layout off would be a one-way door. It is not a second toggle competing with the in-page one — it is the only thing that can speak when there is no Pane.

## Acceptance criteria

- [x] A control in the Comment Pane returns the page to the Native Layout without a reload.
- [x] The page it returns to is the Native Layout exactly — nothing of ours left behind, the Comments back at their exact original parent and position, by the same standard ticket 02 set.
- [x] The choice is remembered across navigation and across browser restarts.
- [x] The toolbar surface brings the layout back, so that turning it off is not a one-way door.
- [x] Switching is visually immediate — no page reload, no flash of a half-arranged page.
- [x] The control is reachable by keyboard and labelled for assistive technology.
- [x] On a page the extension has Stepped Aside from — theater, fullscreen, a Short, a live stream, comments off, a narrow window — the reason is visible somewhere the user can reach, despite there being no Pane.
- [x] The reason shown always matches the Layout Engine's most recent decision, including automatic Step Asides the user did not trigger.
- [x] The surface never reports a reason the engine did not record.
- [x] The stored preference is read at load on a cold page, not only after a re-decision, since a page reloaded while the layout is off must come up in the Native Layout.

## The control is an icon in YouTube's own header, not a bar

Added from use, after the ticket was dispatched: **do not create a new bar or header for the control, and do not let it cost any vertical space.** A separate strip above the Comments is exactly what this was meant to avoid. The control is a small icon placed inline in the Comments' existing header row, beside the sort control — `ytd-comments-header-renderer` in the DOM, with the sort control at `yt-sort-filter-sub-menu-renderer`.

Three consequences, recorded so they are not rediscovered:

- **We are injecting into a YouTube component, not beside it.** YouTube owns that header and re-renders it — on navigation, when the comment count updates, and whenever it chooses. An inserted node can be discarded without warning, so the control must be re-inserted when the header is rebuilt, or shown not to need it. A control that silently disappears the first time YouTube rebuilds its own header is worse than a bar.
- **It must be measured as costing no height.** The header's height with and without the control should be identical; that measurement is the point of the request.
- **It has to look native.** It should match YouTube's own icon-button treatment on that row rather than carrying styling invented for a bar of our own. A control that reads as foreign on YouTube's header is worse than a bar would have been.

Accessibility still applies, and is easier to get wrong for a small icon than for a labelled button: keyboard reachable, labelled for assistive technology, with an obvious focus state.

- [x] The control adds no vertical space — the Comments' header is no taller with it than without it.
- [x] The control sits inline in YouTube's own header row rather than in a strip of ours.
- [x] The control survives YouTube re-rendering its own header.
- [x] The control reads as native to that row.
