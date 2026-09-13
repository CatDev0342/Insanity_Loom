// Menu labels mark their access key the Windows way: an ampersand before the letter ("&File" → File, reached with
// Alt+F). A doubled ampersand ("&&") is a literal one.

/** A label as shown, and the position of its access key within the shown text (-1 when it has none). */
export interface ParsedLabel {
  readonly text: string;
  readonly accessKeyIndex: number;
  /** The access key, lower-cased, or '' when the label has none. */
  readonly accessKey: string;
}

const MARKER = '&';
const NO_ACCESS_KEY = -1;

export function parseLabel(label: string): ParsedLabel {
  let text = '';
  let accessKeyIndex = NO_ACCESS_KEY;
  for (let i = 0; i < label.length; i++) {
    const character = label.charAt(i);
    if (character !== MARKER) {
      text += character;
      continue;
    }
    const next = label.charAt(i + 1);
    if (next === MARKER) {
      text += MARKER;
      i++;
      continue;
    }
    if (next !== '' && accessKeyIndex === NO_ACCESS_KEY) accessKeyIndex = text.length;
  }
  const accessKey = accessKeyIndex === NO_ACCESS_KEY ? '' : text.charAt(accessKeyIndex).toLowerCase();
  return { text, accessKeyIndex, accessKey };
}
