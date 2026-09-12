# 13: The live-chat trigger fires on videos that are not live

**What to build:** A video that is not live must show the Comment Pane by default. Today it does not.

Reported from use against `https://www.youtube.com/watch?v=jvczxxUUqNs`: the extension Stepped Aside with the reason `live-chat`, and the comments stayed below the video. The user's report is that **the live chat panel is not open** — so nothing was occupying the rail, nothing was being displaced, and the Pane should have been there.

The user's rule, in their words: *"If it's not a live video, the comments should be on sidebar by default."*

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## What is probably wrong

Ticket 02's agent verified the trigger on three real live streams, where `ytd-live-chat-frame` materialises in `#chat-container`. The likely fault is that the trigger tests for the *presence of a chat frame* rather than for a chat that is actually going to be displaced. A past live stream can carry a chat replay, and YouTube may mount a chat frame that is collapsed, off-screen, or not in use — none of which justifies giving up the Pane.

**The fix must not simply delete the trigger.** A genuinely live stream must still keep its chat: displacing a live chat from the column the Pane wants is the exact harm ticket 02's Step Aside exists to prevent. The question is what distinguishes "a chat is here and in use" from "a chat frame exists", and the answer should come from measurement on both a live stream and this kind of video rather than from a guess.

## Acceptance criteria

- [ ] A video that is not live shows the Comment Pane, even when a chat frame is present in the page.
- [ ] A genuinely live stream still Steps Aside, with its chat undisplaced — the harm ticket 02 prevents is not reintroduced.
- [ ] The distinction between the two is measured on real pages of both kinds, and stated in the report.
- [ ] The reason recorded on a page that Steps Aside for this trigger is still accurate — no page reports `live-chat` when no chat is in use.
- [ ] If the two cases cannot be told apart reliably, say so plainly rather than shipping a trigger that fails open into displaced chat.
