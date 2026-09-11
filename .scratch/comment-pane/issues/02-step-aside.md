# 02: Step Aside, and why

**What to build:** Whenever the layout doesn't fit or can't be built, the extension does nothing at all and leaves the Native Layout exactly as YouTube made it — and it records a reason for having done so.

**Blocked by:** 01: The Comment Pane appears beside the Player

**Status:** ready-for-agent

- [ ] Theater mode leaves the Native Layout completely untouched.
- [ ] Fullscreen leaves the video unobstructed and the Native Layout untouched.
- [ ] Shorts leaves the page completely alone.
- [ ] A live stream or premiere leaves YouTube's live chat undisplaced.
- [ ] A window too narrow for two columns leaves the Native Layout untouched rather than producing a cramped one.
- [ ] When YouTube itself has collapsed to a single column, the extension Steps Aside — it must never apply a layout into a column YouTube has already hidden, because that is how the Comments silently disappear.
- [ ] A video with comments disabled leaves the Native Layout untouched and shows no empty Pane.
- [ ] An unrecognised page structure Steps Aside loudly rather than failing quietly.
- [ ] YouTube's horizontally-docking panel modes are guarded against, so that a panel competing for the same column causes a Step Aside rather than a collision.
- [ ] Theater mode is detected at page load as well as on toggle, since it persists across loads.
- [ ] Fullscreen is detected from the document's fullscreen state rather than from an attribute.
- [ ] Every trigger routes through a single code path and records a stable reason identifier — not a human-readable message.
- [ ] Stepping Aside from an already-applied layout restores the exact original arrangement, including the Comments' original position and nesting depth.
- [ ] "Never ran" and "ran and then undid itself" are indistinguishable in the resulting page.
- [ ] The manual off switch routes through the same path as every automatic trigger.
- [ ] An automatic Step Aside applies only to the page that tripped it, so one ineligible video does not disable the extension across YouTube.
