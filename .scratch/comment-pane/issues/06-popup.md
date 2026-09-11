# 06: The popup

**What to build:** Click the toolbar icon for a global on/off, an action to reset the Pane's width, and a status line that says whether the Comment Pane is active and — when it isn't — why, in plain language. This is where the promise that Step Aside is visible rather than silent is actually kept.

**Blocked by:** 02: Step Aside, and why; 03: The Splitter

**Status:** ready-for-agent

- [ ] A toolbar popup offers a global on/off control for the extension.
- [ ] The popup offers an action that resets the Comment Pane's width to its default.
- [ ] The popup shows at a glance whether the Comment Pane is currently active.
- [ ] When it is not active, the popup states why, rendered from the reason identifier the Layout Engine recorded.
- [ ] Turning the extension off takes effect on the current page and on pages opened afterwards.
- [ ] The status shown always matches the Layout Engine's actual most recent decision, including automatic Step Asides the user did not trigger.
- [ ] The popup never displays a reason the engine did not record.
