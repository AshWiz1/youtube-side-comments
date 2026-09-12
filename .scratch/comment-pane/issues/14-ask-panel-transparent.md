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
- [x] If `#secondary-inner { position: relative }` turns out to be vestigial, say so and remove it rather than leaving it.
- [x] YouTube's other panels — transcript, chapters — are checked too, and not merely assumed to be fine.
- [x] The Comment Pane, the Splitter's position and drag, the Recommendation Strip and every Step Aside reason are unregressed.
- [ ] If the panel's transparency is not ours, say so and close the ticket rather than inventing a workaround.

## Comments

**The Ask panel itself is unresolved, and this ticket stays open for it.** The smoke harness uses a fresh profile, and signed-out YouTube renders **no Ask button at all** — enumerating every button, `[role=button]`, `yt-button-shape` and `ytd-button-renderer` on a live Watch Page finds only transcript controls. There was no Ask panel to enable, disable or measure, so the user's own comparison is the strongest evidence in this ticket and cannot be reproduced here. **A signed-in profile is what would unblock it.**

Two real findings landed regardless.

**`open-panel` read only `#panels`.** That container holds seven of YouTube's engagement panel renderers, and none of them is Ask — a grep of YouTube's 10.7MB bundle finds no ask target-id in that vocabulary. The trigger now reads all three of YouTube's rail panel stacks: `#panels`, `#inline-panels` (flag-gated in YouTube's own template, invisible to us until now) and `#persistent-panel-container`. Both of the latter are verified live: a panel expanded into either Steps Aside with residue 0, and hiding it returns the page to `applied: on` with the rail back at 402.

**`#secondary-inner { position: relative }` was vestigial and is removed.** It was added so an absolutely-positioned Splitter had a containing block; ticket 09 rebuilt the Splitter as a float, which needs none. Neutralised on a live Watch Page, the rail, Pane, Splitter, `#primary` and the Splitter's `::after` mark were all identical, and `Page.captureScreenshot` came back byte-for-byte identical. The deciding measurement is recorded in the comment in the file.

**A correction worth recording, because it was mine.** I instructed the agent that docking panels — Ask and live chat — must be distinguished from panels that merely stack, and that the stacking ones should keep the Pane. **They cannot be distinguished.** Measured, live chat, the comments engagement panel and the transcript are geometrically the same act: each takes the rail's own width and pushes the related list below, none changes the rail's width, none touches the Player. The comments panel I had cited as the exemplar of "merely stacks" measures `[1358,68,515,809]` — identical to live chat. The agent declined to act on an instruction it could not measure, which is the right call and why the existing trigger was left alone.

**Unverified, and named rather than guessed at.** YouTube has a `side-rail-dismissible-panels` mode whose stylesheet hides `#secondary` — the box the Pane lives in — via `opacity: 0; pointer-events: none; transform: translateX(240px); visibility: hidden`, and under which it sets `#secondary` to a docked, fixed layout whose width our `!important` override fights. That is the likeliest mechanical cause of "a panel painting in the wrong box". It is not in the Step Aside list deliberately: every attribute there makes the extension yield, and if YouTube ships this as a standing layout rather than a panel signal, adding it would disable the extension for everyone in it. **One signed-in reproduction showing that attribute on the watch root while Ask is open would settle it.**

**Known over-fire left alone:** the ads and search-preview panels report `EXPANDED` while taking `[515,2]` — not competing for the column — and we Step Aside for them anyway. Gating on measured height would risk missing a panel that has not laid out yet, which is the worse failure.
