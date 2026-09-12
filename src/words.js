/**
 * What the two surfaces say, in one place.
 *
 * The engine speaks in stable identifiers and never in sentences — see `REASON`
 * — and two things render them: the toolbar popup and the status view in the
 * Comment Pane. The sentences live here rather than in both, so the two cannot
 * drift into telling a reader different things about the same decision.
 */
import { SURFACE, REASON } from './engine.js';

/** The state of the page behind the surface. */
export const STATUS = {
  [SURFACE.APPLIED]: 'Side comments are on this video.',
  [SURFACE.OFF]: 'Side comments are off everywhere.',
  [SURFACE.STEPPED_ASIDE]: "This page is YouTube's own layout.",
  [SURFACE.ELSEWHERE]: 'No side-comments layout on this page.',
};

/** What each of the engine's reasons means to a reader. Every reason the engine
 *  can record has a line. */
export const WHY = {
  [REASON.DISABLED]: 'You turned them off.',
  [REASON.NOT_WATCH_PAGE]: 'This is a YouTube page, not a video.',
  [REASON.UNRECOGNISED_STRUCTURE]: "This page isn't shaped the way YouTube pages usually are.",
  [REASON.SHORTS]: 'Side Comments stays out of Shorts.',
  [REASON.FULLSCREEN]: 'The video is fullscreen.',
  [REASON.THEATER]: 'The video is in theater mode.',
  [REASON.LIVE_CHAT]: 'A live stream keeps its live chat where it is.',
  [REASON.OPEN_PANEL]: 'A YouTube panel is open beside the Player.',
  [REASON.COMMENTS_DISABLED]: "This video's comments are turned off.",
  [REASON.SINGLE_COLUMN]: 'The window is too narrow for two columns.',
  [REASON.TOO_NARROW]: 'The window is too narrow for a Comment Pane.',
};

/** The line the status view leaves behind, which is the whole of what it can
 *  say about the case that matters most: with no Comment Pane there is no
 *  status view, and the toolbar is the only thing that can report a reason. */
export const ELSEWHERE_HINT = 'No Comment Pane? The toolbar icon says why.';
