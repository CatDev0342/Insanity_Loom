// What of a replayed conversation is the author's own writing.
//
// A conversation's history holds everything that was said to the assistant, and not all of it was said by the author.
// The program that runs the assistant puts its own words in — notices that a task has finished, reminders about how
// the session is set up — wrapped in tags of its own. They belong to the machinery, not to the author, and a whisper
// is the author's prose.
//
// So on catching up with a conversation, anything wrapped in one of those is left out. What the author wrote is kept
// exactly as they wrote it; a turn that was nothing but machinery is left out altogether.

/** The tags the machinery wraps its own words in. */
const MACHINERY = ['system-reminder', 'task-notification'];

const BLOCKS = new RegExp(`<(${MACHINERY.join('|')})\\b[\\s\\S]*?<\\/\\1>`, 'gi');

/** A piece of replayed history with the machinery's own words taken out. */
export function theAuthorsOwn(written: string): string {
  return written.replace(BLOCKS, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Whether a piece of replayed history was nothing but the machinery talking to itself. */
export function isAllMachinery(written: string): boolean {
  return written.trim() !== '' && theAuthorsOwn(written) === '';
}
