# 14: The Ask panel renders transparent

**What to build:** Opening the "Ask" button beside Share, which opens YouTube's Gemini chat panel, must leave that panel legible. Reported from use, it renders transparent and is difficult to read.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## The leading suspect, which is a rule of ours

Ticket 03 added `#secondary-inner { position: relative }` so that an absolutely-positioned Splitter had a containing block to anchor to. **Ticket 09 then rebuilt the Splitter as a float** (`position: sticky; float: left; margin-left: -12px`), and a float does not need a positioned ancestor.

So that rule may now be doing nothing for us while still changing the containing block that YouTube's engagement panel positions itself against — which would show up exactly as described: a panel painting in the wrong box, without its background.

**That is a hypothesis, not a diagnosis.** The first thing to establish is whether the fault is ours at all: **compare the panel with the extension disabled.** If it renders the same way with the extension off, this is YouTube's and the ticket changes shape entirely. Establish that before changing anything.

## What this must not become

The tempting fix is to Step Aside whenever a panel opens. **Do not do that.** The agreed behaviour is that panels *stack* in the rail and only YouTube's horizontally-docking, flag-gated panel modes cause a Step Aside — that decision was made deliberately, and stepping aside on every Ask would take the Comment Pane away for a panel that is not competing for space.

## Acceptance criteria

- [ ] The Ask panel renders legibly with the extension active — background, contrast and position as YouTube intends.
- [ ] Whether the fault is ours is established by comparison with the extension disabled, and stated plainly.
- [ ] If one of our rules is responsible, it is **removed or corrected**, not compensated for with an override on top.
- [ ] If `#secondary-inner { position: relative }` turns out to be vestigial, say so and remove it rather than leaving it.
- [ ] YouTube's other panels — transcript, chapters — are checked too, and not merely assumed to be fine.
- [ ] The Comment Pane, the Splitter's position and drag, the Recommendation Strip and every Step Aside reason are unregressed.
- [ ] If the panel's transparency is not ours, say so and close the ticket rather than inventing a workaround.
