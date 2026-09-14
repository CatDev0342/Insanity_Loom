// Checking that a whisper survived being opened.
//
// A whisper is read from its file and given to the editor, which understands a known set of elements and quietly
// drops anything else. That is reasonable for pasted rubbish and unreasonable for the author's own writing: whatever
// is dropped would be written back over the file at the next save, and the writing would be gone for good, from a
// file that was safely on disk a moment earlier.
//
// So what the file said is weighed against what the editor holds. If writing went missing, the file is kept aside
// before anything is saved over it, and the author is told where it is. The program does not decide that a loss is
// small enough to ignore.

/** How much of the writing may differ before it counts as lost — nothing, beyond the whitespace markup carries. */
const ALLOWED_DIFFERENCE = 0.02;

/** The writing in a piece of markup, as the author reads it: no tags, no runs of space. */
export function writingIn(markup: string): string {
  return markup
    .replace(/<head\b[\s\S]*?<\/head>/i, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** How many pictures a piece of markup holds. A picture has no words, so it must be counted for itself. */
export function picturesIn(markup: string): number {
  return [...markup.matchAll(/<img\b/gi)].length;
}

/** Whether opening a whisper lost any of it, and by how much. */
export function whatWasLost(fromTheFile: string, nowInTheWhisper: string): { readonly lost: boolean; readonly share: number } {
  const before = writingIn(fromTheFile).length;
  const after = writingIn(nowInTheWhisper).length;
  // A picture lost is a loss whatever the words say.
  if (picturesIn(nowInTheWhisper) < picturesIn(fromTheFile)) return { lost: true, share: 1 };
  if (before === 0) return { lost: false, share: 0 };
  const share = Math.max(0, (before - after) / before);
  return { lost: share > ALLOWED_DIFFERENCE, share };
}
