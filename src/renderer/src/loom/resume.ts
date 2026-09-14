// The Resume Conversation dialog: the assistant's past conversations, newest first, one button each. The arrows move
// between them, Enter chooses, Esc closes without choosing.
//
// The list is a list of choices and says so plainly — a group of buttons with a name — rather than wearing the roles
// of a listbox whose options are buttons, which is two patterns at once and neither of them properly. By the keyboard
// it is one stop, as the editing shortcuts are: a hundred conversations must not be a hundred presses of Tab.

import type { ConversationSummary } from '../../../shared/assistant';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function when(updatedAt: string): string {
  const date = new Date(updatedAt);
  return updatedAt === '' || Number.isNaN(date.getTime()) ? '' : DATE_FORMAT.format(date);
}

/** Shows the dialog and resolves with the chosen conversation's id, or undefined when the author closes it. */
export async function chooseConversation(
  dialog: HTMLDialogElement,
  list: () => Promise<readonly ConversationSummary[]>,
): Promise<string | undefined> {
  const listing = document.createElement('div');
  listing.className = 'resume-list';
  listing.setAttribute('role', 'group');
  listing.setAttribute('aria-label', 'Earlier conversations');
  listing.textContent = 'Asking the assistant for its conversations…';

  const heading = document.createElement('h2');
  heading.id = 'resume-heading';
  heading.textContent = 'Resume a conversation';
  dialog.setAttribute('aria-labelledby', heading.id);
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Cancel';
  close.addEventListener('click', () => dialog.close(''));
  dialog.replaceChildren(heading, listing, close);
  dialog.returnValue = '';
  dialog.showModal();

  let conversations: readonly ConversationSummary[] = [];
  let failure: string | undefined;
  try {
    conversations = await list();
  } catch (problem) {
    failure = `The conversations could not be listed: ${problem instanceof Error ? problem.message : String(problem)}`;
  }
  listing.replaceChildren();
  if (failure !== undefined) listing.textContent = failure;
  else if (conversations.length === 0) listing.textContent = 'The assistant has no earlier conversations in this folder.';
  const buttons = conversations.map((conversation) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'resume-choice';
    const title = document.createElement('span');
    title.className = 'resume-title';
    title.textContent = conversation.title;
    const date = document.createElement('span');
    date.className = 'resume-date';
    date.textContent = when(conversation.updatedAt);
    button.append(title, date);
    button.addEventListener('click', () => dialog.close(conversation.id));
    return button;
  });
  buttons.forEach((button, index) => {
    button.tabIndex = index === 0 ? 0 : -1;
  });
  listing.append(...buttons);
  buttons[0]?.focus();

  listing.addEventListener('keydown', (event) => {
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index === -1) return;
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : step === 0 ? -1 : (index + step + buttons.length) % buttons.length;
    if (next === -1) return;
    event.preventDefault();
    for (const button of buttons) button.tabIndex = -1;
    const moved = buttons[next];
    if (moved === undefined) return;
    moved.tabIndex = 0;
    moved.focus();
  });

  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === '' ? undefined : dialog.returnValue), { once: true });
  });
}
