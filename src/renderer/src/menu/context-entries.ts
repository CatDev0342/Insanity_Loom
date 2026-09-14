// What the right-click menu offers, decided from what Chromium reports about the place clicked (src/shared/editing.ts).
// A pure function, so what appears where can be tested without a window.

import type { CommandId } from '../../../shared/commands';
import type { ContextDetails } from '../../../shared/editing';

export type ContextAction =
  | { readonly kind: 'command'; readonly command: CommandId }
  | { readonly kind: 'replace'; readonly suggestion: string }
  | { readonly kind: 'addToDictionary'; readonly word: string }
  /** Quote what was right-clicked at the end of the whisper, to write an answer under it. */
  | { readonly kind: 'quote' };

export type ContextEntry =
  | {
      readonly kind: 'entry';
      /** The label, with its access key marked by '&'. */
      readonly label: string;
      readonly shortcut: string;
      readonly enabled: boolean;
      readonly action: ContextAction;
      /** Spelling suggestions are drawn in bold, as desktop spell checkers draw them. */
      readonly emphasized: boolean;
    }
  | { readonly kind: 'separator' };

// A long list of suggestions is cut to the first few, as desktop spell checkers do.
const MOST_SUGGESTIONS_SHOWN = 5;

const SEPARATOR: ContextEntry = { kind: 'separator' };

function command(label: string, commandId: CommandId, shortcut: string, enabled: boolean): ContextEntry {
  return { kind: 'entry', label, shortcut, enabled, action: { kind: 'command', command: commandId }, emphasized: false };
}

/**
 * The entries for a right-click, in order. Empty when there is nothing to offer.
 *
 * `inTheWhisper` says whether the author clicked in their writing rather than in one of the program's own fields:
 * quoting what was said means nothing in a settings box.
 */
export function contextEntries(details: ContextDetails, inTheWhisper = false): readonly ContextEntry[] {
  const entries: ContextEntry[] = [];

  if (details.misspelledWord !== '') {
    const suggestions = details.suggestions.slice(0, MOST_SUGGESTIONS_SHOWN);
    for (const suggestion of suggestions) {
      // A suggestion's own letters are not access keys: an ampersand in one is shown as itself.
      entries.push({
        kind: 'entry',
        label: suggestion.replace(/&/g, '&&'),
        shortcut: '',
        enabled: true,
        action: { kind: 'replace', suggestion },
        emphasized: true,
      });
    }
    if (suggestions.length === 0) {
      entries.push({ kind: 'entry', label: 'No spelling suggestions', shortcut: '', enabled: false, action: { kind: 'replace', suggestion: '' }, emphasized: false });
    }
    entries.push({
      kind: 'entry',
      label: `Add "${details.misspelledWord.replace(/&/g, '&&')}" to &Dictionary`,
      shortcut: '',
      enabled: true,
      action: { kind: 'addToDictionary', word: details.misspelledWord },
      emphasized: false,
    });
    entries.push(SEPARATOR);
  }

  if (details.isEditable) {
    // Quoting comes first, as it does in a chat program: it is what a right-click on something said is usually for.
    if (inTheWhisper) {
      entries.push(
        { kind: 'entry', label: '&Quote', shortcut: '', enabled: true, action: { kind: 'quote' }, emphasized: false },
        SEPARATOR,
      );
    }
    entries.push(
      command('&Undo', 'edit.undo', 'Ctrl+Z', details.canUndo),
      command('&Redo', 'edit.redo', 'Ctrl+Y', details.canRedo),
      SEPARATOR,
      command('Cu&t', 'edit.cut', 'Ctrl+X', details.canCut),
      command('&Copy', 'edit.copy', 'Ctrl+C', details.canCopy),
      command('&Paste', 'edit.paste', 'Ctrl+V', details.canPaste),
      SEPARATOR,
      command('Select &All', 'edit.selectAll', 'Ctrl+A', details.canSelectAll),
    );
  } else if (details.hasSelection || details.canSelectAll) {
    // Reading text that cannot be changed — the conversation — can still be copied.
    entries.push(
      command('&Copy', 'edit.copy', 'Ctrl+C', details.canCopy),
      command('Select &All', 'edit.selectAll', 'Ctrl+A', details.canSelectAll),
    );
  }

  while (entries.at(-1)?.kind === 'separator') entries.pop();
  return entries;
}
