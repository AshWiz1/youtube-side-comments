# 12: Recommendation Strip tiles are too small and too many

**What to build:** The Recommendation Strip currently lays out five columns of small tiles — measured at a 1889px strip, tiles of 359×134. The user finds them tiny and the number of them overwhelming, and asks for four per row at a substantially larger size, closer to the tiles on YouTube's home page.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## One uncertainty to resolve rather than paper over

YouTube's related-videos list and its home-page grid use **different item types** — the related list renders compact items, the home page renders rich tiles. Whether the related items can be made to render as rich tiles at all is unverified, and it may mean fighting the renderer.

If the rich tile shape cannot be had, deliver the largest and best-proportioned tile the renderer actually allows, and **say plainly that the home-page shape was not reachable**. Do not quietly ship something that still looks wrong while calling the ticket done.

## Acceptance criteria

- [ ] The Strip lays out four tiles per row at a wide viewport.
- [ ] Tiles are substantially larger than the current 359×134.
- [ ] Tile proportions look right at the new size — neither squat nor stretched.
- [ ] The Strip remains responsive at narrower viewports rather than holding four columns into a width that cannot take them.
- [ ] No horizontal overflow at any width.
- [ ] The Strip's Step Aside revert — returning the related list to its exact original position — is unregressed.
- [ ] Whether the home-page tile shape was reachable is stated explicitly in the report.

## Shorts break the grid

Reported from use, and the same surface as the sizing above, so it is fixed here rather than in a ticket of its own: when Shorts appear in the Strip the layout breaks. Each Short takes a whole row to itself, with no other tile beside it, and they run one after another down the height of the Strip.

Shorts are vertical tiles in a grid built for horizontal ones, so they neither share a row nor hold a sensible proportion — a 9:16 tile in a column sized for 16:9 either stretches or dwarfs its row.

- [ ] Shorts in the Strip do not each occupy a row of their own.
- [ ] A Short's tile holds a sensible proportion rather than being stretched to the row's height.
- [ ] A row holding both Shorts and ordinary videos lays out coherently rather than one shape dictating the other.
- [ ] The fix does not simply hide Shorts — they are legitimate recommendations.
