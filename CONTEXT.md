# YoutubeSideComments

A browser extension that relocates the comment section of a YouTube Watch Page into a resizable pane beside the Player, so a video and its comments can be read at the same time.

## Language

**Watch Page**:
The YouTube page that plays a single video, at `youtube.com/watch`.
_Avoid_: Video page, watch view

**Player**:
The video surface and its playback controls on a Watch Page.
_Avoid_: Video (when you mean the surface rather than the content)

**Comments**:
The comment thread YouTube itself owns and renders — replies, sorting, likes, and the composer included. Not ours; we only relocate it.
_Avoid_: Comment section (ambiguous — may mean the page region rather than the thread)

**Comment Pane**:
Our container that holds the relocated Comments. Ours, and therefore disposable.
_Avoid_: Sidebar, comments sidebar, panel

**Splitter**:
The draggable vertical divider between the Player and the Comment Pane, which sets the Pane's width.
_Avoid_: Handle, resizer, drag bar, gutter

**Recommendation Strip**:
YouTube's related-videos list, relocated out of the right rail into a full-width region below the Player and Comment Pane.
_Avoid_: Sidebar, related, up next

**Native Layout**:
YouTube's unmodified page layout — what remains on any page where the extension does nothing.
_Avoid_: Default view, vanilla, fallback layout

**Step Aside**:
The extension's deliberate refusal to apply its layout on a given page or surface, leaving Native Layout intact.
_Avoid_: Disable, bail out, opt out
