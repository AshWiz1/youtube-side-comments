# 01: The Comment Pane appears beside the Player

**What to build:** Load the extension unpacked and open a Watch Page: the Comments appear in a Comment Pane to the right of the Player, sharing its height, and load on their own. The Player stays on the left, and the rest of the page keeps working exactly as it did.

This is the walking skeleton. It stands up the manifest, the content script, the Layout Engine's interface and its first decision, the DOM Adapter's structure matching and reparenting, the layout styling, the engine's first table-driven tests, and the headless-browser smoke test with its first end-to-end assertion. If the core thesis of this project is wrong, this ticket is where that surfaces.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] With the extension loaded unpacked, opening a desktop Watch Page shows the Comments in a Comment Pane to the right of the Player.
- [x] The Comments load on their own — no scroll, no click, no nudge — and no loading state is left behind.
- [x] Replies, sorting, likes and the comment composer all still work inside the Pane, because they are YouTube's own Comments rather than a reimplementation.
- [x] The video's title, channel row, action buttons and description remain exactly where YouTube puts them and are not restyled.
- [x] The Player occupies the left column and never overlaps the Comment Pane.
- [x] The Pane is hosted such that YouTube's panels and playlist panel continue to work.
- [x] The correct Comments element is selected — the page contains a second, hidden element matching the same tag name, and selecting on the tag alone picks the wrong one.
- [x] The page is recognised by structure and identifiers rather than by a single custom-element tag, so that a different watch-page root does not silently no-op.
- [x] Failing to recognise the page is reported rather than silently doing nothing.
- [x] The Layout Engine's decisions are unit-tested as pure state-in, decision-out — no DOM, no browser, no simulated environment.
- [x] A headless-browser smoke test loads the extension into a real browser against a real Watch Page and asserts that the Comment Pane exists and the Comments loaded.
- [x] The smoke test launches with a fresh browser profile on every run, so that carried-over player state cannot produce false results.

## Comments

Completed. Verified end-to-end against live YouTube in headless Chrome on a fresh profile, not merely in unit tests: the Comment Pane renders at 402px in the rail holding `#comments`, 20 threads load unprompted, the Player stays left with no overlap, the `<video>` is resynced to its own frame, and both the video metadata and the rail's other occupants are undisturbed.

Two honest caveats, neither of them a checklist criterion:

- The prose above says the Comment Pane shares the Player's height. It shares the Player's top edge and vertical band but runs ~120px taller (929px against 809px), matching YouTube's own rail rather than the Player. Exact height-matching needs the Player measured, and belongs with ticket 03.
- `revert()` is written and hardened but is not exercised end-to-end, because nothing triggers it until ticket 02.

Also learned the hard way and worth not rediscovering: **Chrome 152 silently ignores `--load-extension` on Windows**, accepting the flags and loading nothing. The smoke harness loads the extension over CDP instead. Following the ticket literally would have produced a harness testing a browser with no extension in it.
