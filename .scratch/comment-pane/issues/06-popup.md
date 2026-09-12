# 06: The toggle, in the Pane rather than the toolbar

**What to build:** A control in the Comment Pane that switches between the side-comments layout and the Native Layout, so leaving the layout does not mean going to the browser toolbar.

This replaces the original plan for this ticket, which was a toolbar popup. The user used the extension and asked for the control to live in the Pane, where they are already looking.

**Blocked by:** 02: Step Aside, and why; 03: The Splitter

**Status:** ready-for-agent

## The shape, and why a toolbar surface survives

There is no Pane on a page the extension has Stepped Aside from — theater mode, fullscreen, a Short, a live stream, comments turned off, a narrow window — so an in-page control cannot exist there. That is exactly when the reason for stepping aside is worth knowing.

So: **the in-page control is the primary way to leave and rejoin the layout, and a minimal toolbar surface remains as the only place that can report why the extension stood down.** The toolbar surface is not a second toggle; it exists to carry the reason.

## Acceptance criteria

- [ ] A control in the Comment Pane returns the page to the Native Layout without a reload.
- [ ] The same control brings the side-comments layout back.
- [ ] The choice is remembered across navigation and across browser restarts.
- [ ] Switching is visually immediate — no page reload, no flash of a half-arranged page.
- [ ] The control is reachable by keyboard and labelled for assistive technology.
- [ ] On a page the extension has Stepped Aside from, the reason is visible somewhere the user can reach, despite there being no Pane.
- [ ] The reason shown always matches the Layout Engine's most recent decision, including automatic Step Asides the user did not trigger.
- [ ] The surface never reports a reason the engine did not record.
