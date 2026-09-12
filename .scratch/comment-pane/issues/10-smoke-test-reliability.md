# 10: The smoke test is unreliable on a live network

**What to build:** The smoke test is the only thing verifying this extension against real YouTube, and it fails for environmental reasons often enough to stop being trustworthy. Across ticket 03's runs, two failed on the environment — one could not load the first page at all, one timed out loading the next video — with no code change between them, against three that were green. A test that fails a third of the time regardless of the code teaches its reader to ignore it, which is worse than not having it, because it is the sole guard on everything the unit tests cannot reach.

The failures are environmental rather than spurious assertions, so the fix belongs in how the harness handles a slow or unreachable page — not in loosening what it asserts.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A smoke run that fails does so because the extension is wrong, not because YouTube was slow.
- [ ] Genuine extension failures are still reported as failures — reliability must not be bought by weakening an assertion.
- [ ] The harness says which kind of failure it hit, so a reader can tell them apart without reading the log.
- [ ] Repeated consecutive runs pass without intervention.

## Comments

**A second cause, found while completing ticket 08.** The smoke suite also fails for a reason that is not the network: `hopFromChannel` depends on a channel page whose videos are *varied*, and in this environment the channel it hops through now serves only children's and live content — every landing reads "Comments are turned off. Learn more", so after eight attempts the helper throws.

This is not a product failure — the extension correctly declines each landing — but it makes two navigation criteria intermittent, which is the same trust problem this ticket exists to solve: a red test that is not about the code.

The fix is to make the fixture deterministic rather than dependent on whatever the channel happens to offer — pin the videos the navigation tests use, or discover candidates rather than hoping. The suite's own comments already anticipate the drift; the fixture has now drifted.

Note also that a navigation test's landing is *not* the only environmental input: YouTube intermittently fires `yt-navigate-start` and never `yt-navigate-finish`, which the tests already document. A deterministic fixture should not rest on that either.
