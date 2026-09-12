# 16: Shorts in the Recommendation Strip are the wrong shape and take whole rows

**What to build:** A Short in the Recommendation Strip should look like a Short — vertical — and should share rows with its neighbours. Today it renders at ordinary video proportions and each one occupies a row of its own.

Reported from use, second time of asking: *"The short tiles in recommendation section are different size. usually short tiles are vertical but they are normal video sized. And also each short occupies full row in recommendations."*

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Why ticket 12 could not reproduce it

Ticket 12 added guards for two Shorts shapes and **observed neither** — it checked the fixture video, five music videos, a Short's own watch page, eight search-derived videos and every scroll-walked list, and in every one a Short in the related list was an ordinary card at 16:9.

**The likely reason, and it is testable: the harness runs signed out.** A fresh browser profile has no session, and a signed-in YouTube may serve a different related list from a signed-out one. If that is the explanation, the shape will stay unreachable in this harness no matter how many videos are tried, and pretending otherwise wastes the effort.

## What "fixed" means

1. **A Short keeps its own proportion.** Vertical, not cropped into a 16:9 slot. Ticket 12 chose uniformity — forcing every thumbnail to 16:9 — which crops a vertical video. The user's expectation is the opposite: a Short should look like a Short.
2. **Shorts share rows.** Several side by side, never one per row. Note what this implies: a vertical tile at the ordinary tile width would be enormously tall, so sharing a row means the Shorts row uses a smaller tile than the ordinary rows. That is also how YouTube presents them on its own home page, in a dedicated shelf of small vertical tiles.
3. **Ordinary tiles are unaffected** — the four-per-row grid, the tile size and the home-page shape ticket 12 established all stay as they are.

## Prefer construction over observation

Since the shape may never be reachable here, **the fix should be one that cannot produce the failure**, rather than one keyed to markup nobody has seen:

- Nothing inside the Strip should be able to span a row, or to sit outside the strip's own column flow.
- Any container YouTube nests inside the Strip — a shelf, a section, a lockup list — must itself lay its items out in columns, so that a shape we have never seen still lands in the grid.
- A Short's proportion should come from its own content rather than from a rule of ours that flattens it.

Ticket 12's guard for a Shorts *section* was written structurally and never measured against a real one. Find out whether it does anything.

## Acceptance criteria

- [x] A Short in the Strip renders with its native vertical proportion rather than being forced to 16:9.
- [x] Shorts share rows with each other — no Short occupies a row alone.
- [x] Ordinary related videos are unchanged: four per row, the size and shape ticket 12 established.
- [ ] No element inside the Strip can span a full row or escape the column flow, whatever shape YouTube serves.
- [x] The tile shapes no longer depend on YouTube's internal class names for the vertical-versus-compact distinction.
- [x] Whether the shape could be reproduced at all is stated plainly. If it could not, the report says so and justifies the change as construction rather than as observation — and says what would falsify it.
