// Whether a turn that ended should go again.
//
// The author writes a section, closes it, and it goes to the assistant. If the connection falls over, or the host
// goes quiet while they are away, the turn ends with nothing having come back — and used to sit there unanswered
// until they noticed, closed the program and opened it again (the designer, 2026-Sep-14). A turn nothing came back
// for never happened, so it goes again by itself.
//
// The rule has to be careful in three directions at once. A turn the author *stopped* was stopped because they said
// so. A turn the assistant finished without saying anything is finished, not unheard. And a turn that keeps failing
// must not be sent round and round forever: after so many tries the author is told plainly instead.

import type { ReplyState } from '../document/extensions';

/** How many times one turn may go out before the author is told it is not getting through. */
export const MOST_TRIES = 2;

/** A reply that has just ended: what was sent, what came back, and how many times it has gone. */
export interface EndedReply {
  /** What came back. Empty means not one word of it arrived. */
  readonly markdown: string;
  /** The author's words that were sent. Empty when the assistant spoke without being asked. */
  readonly sent: string;
  readonly tries: number;
}

/** Whether nothing whatever came back of a turn the author sent — so far as the assistant is concerned, it never was. */
export function wentUnheard(reply: EndedReply, state: ReplyState): boolean {
  return reply.markdown === '' && reply.sent !== '' && (state === 'failed' || state === 'waiting');
}

/** Whether to send it again: unheard, and not already tried as often as a turn is ever tried. */
export function sendAgain(reply: EndedReply, state: ReplyState, mostTries: number = MOST_TRIES): boolean {
  return wentUnheard(reply, state) && reply.tries < mostTries;
}
