/**
 * The chat scrollport, as seen by the preview that takes it over.
 *
 * dsh's contract for a view owning the scrollport collapses the conversation
 * flow to the viewport and clips it, so the browser clamps the reader's offset
 * to zero the moment the overlay mounts. Reading it afterwards is too late, and
 * writing it back before the overlay leaves is clamped again: whoever takes the
 * scrollport owns both ends of that trade, and this is where they live.
 */
const CHAT_SCROLL = "[data-conversation-scroll]";

export class ChatScrollport {
  constructor(find = () => globalThis.document?.querySelector(CHAT_SCROLL) ?? null) {
    this.find = find;
  }

  /** The reader's current offset, or null when no scrollport is on screen. */
  offset() {
    const element = this.find();
    return element === null || element === undefined ? null : element.scrollTop;
  }

  scrollTo(offset) {
    const element = this.find();
    if (element === null || element === undefined) return;
    element.scrollTop = offset;
  }
}
