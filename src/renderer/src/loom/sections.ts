// How the author marks a section finished: a line holding only three hyphens, ended with Enter — the same "---" that
// draws a dividing line in a word processor. Everything written above that line is the finished section.

/** The line that finishes a section, once surrounding spaces are ignored. */
export const SECTION_MARK = '---';

export interface FinishedSection {
  /** The finished writing, without the mark and without trailing blank space. */
  readonly section: string;
  /** Whatever was written after the mark's line, which stays where the author is writing. */
  readonly remaining: string;
}

/**
 * Whether pressing Enter with the caret at `caret` finishes a section: the caret must sit at the end of a line
 * holding only the mark, with writing above it. Returns undefined otherwise, and Enter is an ordinary new line.
 */
export function finishedSectionAt(text: string, caret: number): FinishedSection | undefined {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const nextBreak = text.indexOf('\n', caret);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  if (caret !== lineEnd) return undefined;
  if (text.slice(lineStart, lineEnd).trim() !== SECTION_MARK) return undefined;

  const section = text.slice(0, lineStart).trimEnd();
  if (section.trim() === '') return undefined;
  const remaining = nextBreak === -1 ? '' : text.slice(nextBreak + 1);
  return { section, remaining };
}
