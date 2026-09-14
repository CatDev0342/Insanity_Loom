// Catching a whisper up with its conversation.
//
// The whisper is the record, and only a running Insanity_Loom writes it. So anything said while it was closed — or
// said through another program driving the same conversation — is in the assistant's history but not in the whisper.
// On resuming the conversation a whisper already records, its history is compared with what the whisper holds, and
// only what is missing is brought in. Nothing already recorded is written twice, and the author's own edits are left
// alone.
//
// The comparison counts exchanges, not words: the author's finished sections are what both sides agree on, in order.
// An exchange the whisper already has is skipped; one it lacks is appended. The one exception is the last reply: if
// the whisper's last reply never finished (the window closed while it was being written) and the history has it
// whole, that reply is filled in.

/** One piece of a replayed history, in the order it was said. */
export type HistoryPiece =
  | { readonly kind: 'author'; readonly markdown: string }
  | { readonly kind: 'reply'; readonly markdown: string };

/** What the whisper already holds of its conversation. */
export interface WhisperRecord {
  /** How many finished sections the author has in it. */
  readonly sections: number;
  /** The last reply in it, when there is one. */
  readonly lastReply?: { readonly replyId: string; readonly finished: boolean };
}

export interface CatchUp {
  /** Markdown to write into the whisper's last reply, when that reply never finished and the history has it. */
  readonly fillLastReply?: { readonly replyId: string; readonly markdown: string };
  /** What to add at the end, in order. */
  readonly append: readonly HistoryPiece[];
}

const NOTHING_MISSING: CatchUp = { append: [] };

/** What the whisper is missing from its conversation's history. */
export function catchUpWith(record: WhisperRecord, history: readonly HistoryPiece[]): CatchUp {
  // Walk the history to the end of the exchange the whisper already has: one author piece per finished section.
  let index = 0;
  let sectionsSeen = 0;
  while (index < history.length && sectionsSeen < record.sections) {
    if (history[index]?.kind === 'author') sectionsSeen += 1;
    index += 1;
  }
  // The history is shorter than the whisper (the author wrote sections this conversation never received, or the
  // history was trimmed): there is nothing to bring in.
  if (sectionsSeen < record.sections) return NOTHING_MISSING;

  let fillLastReply: CatchUp['fillLastReply'];
  const lastReply = record.lastReply;
  // The piece right after the last recorded section is that section's reply. When the whisper's copy of it never
  // finished, the history's whole reply replaces it rather than being appended as a new one.
  if (lastReply !== undefined && !lastReply.finished && history[index]?.kind === 'reply') {
    const piece = history[index];
    if (piece !== undefined) fillLastReply = { replyId: lastReply.replyId, markdown: piece.markdown };
    index += 1;
  } else if (lastReply !== undefined && lastReply.finished && history[index]?.kind === 'reply') {
    // Already recorded whole; skip it.
    index += 1;
  }

  const append = history.slice(index);
  if (fillLastReply === undefined && append.length === 0) return NOTHING_MISSING;
  return fillLastReply === undefined ? { append } : { fillLastReply, append };
}

/** How the author is told what was brought in; empty when nothing was. */
export function describeCatchUp(catchUp: CatchUp): string {
  const sections = catchUp.append.filter((piece) => piece.kind === 'author').length;
  const replies = catchUp.append.filter((piece) => piece.kind === 'reply').length + (catchUp.fillLastReply === undefined ? 0 : 1);
  if (sections === 0 && replies === 0) return '';
  const parts: string[] = [];
  if (sections > 0) parts.push(`${sections} ${sections === 1 ? 'section' : 'sections'} you wrote`);
  if (replies > 0) parts.push(`${replies} ${replies === 1 ? 'reply' : 'replies'}`);
  return `Brought in ${parts.join(' and ')} said while this whisper was not open.`;
}
