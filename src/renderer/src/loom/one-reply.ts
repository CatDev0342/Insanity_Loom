// Gathering a reply that arrives as several messages.
//
// An assistant that speaks, runs a command, and speaks again sends several messages in one reply. Laid end to end
// they read as one run-on sentence — "…so I fixed it:Now the next thing" — because the end of one message and the
// start of the next were never meant to touch. They are separate remarks, and are kept as separate paragraphs.
//
// Nothing is added inside a message: what the assistant wrote is what the author reads, to the letter.

/** A reply being gathered: what has arrived, and which message the last piece belonged to. */
export interface ReplyBeingWritten {
  readonly markdown: string;
  readonly messageId: string;
}

export const NOTHING_YET: ReplyBeingWritten = { markdown: '', messageId: '' };

/** Adds a piece of a reply to what has arrived so far, parting messages with a blank line. */
export function withPiece(sofar: ReplyBeingWritten, text: string, messageId: string): ReplyBeingWritten {
  if (text === '') return sofar;
  const another = sofar.markdown !== '' && messageId !== sofar.messageId;
  // A message that already ends its own paragraph needs nothing added; one that does not is parted from the next.
  const parting = another && !sofar.markdown.endsWith('\n\n') ? (sofar.markdown.endsWith('\n') ? '\n' : '\n\n') : '';
  return { markdown: `${sofar.markdown}${parting}${text}`, messageId };
}
