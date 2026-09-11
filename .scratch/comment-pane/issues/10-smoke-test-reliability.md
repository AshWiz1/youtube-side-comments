# 10: The smoke test is unreliable on a live network

**What to build:** The smoke test is the only thing verifying this extension against real YouTube, and it fails for environmental reasons often enough to stop being trustworthy. Across ticket 03's runs, two failed on the environment — one could not load the first page at all, one timed out loading the next video — with no code change between them, against three that were green. A test that fails a third of the time regardless of the code teaches its reader to ignore it, which is worse than not having it, because it is the sole guard on everything the unit tests cannot reach.

The failures are environmental rather than spurious assertions, so the fix belongs in how the harness handles a slow or unreachable page — not in loosening what it asserts.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A smoke run that fails does so because the extension is wrong, not because YouTube was slow.
- [ ] Genuine extension failures are still reported as failures — reliability must not be bought by weakening an assertion.
- [ ] The harness says which kind of failure it hit, so a reader can tell them apart without reading the log.
- [ ] Repeated consecutive runs pass without intervention.
