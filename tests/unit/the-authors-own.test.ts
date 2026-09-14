// What of a replayed conversation belongs in the whisper: the author's own writing, and nothing the machinery said.
import { describe, expect, it } from 'vitest';
import { isAllMachinery, theAuthorsOwn } from '../../src/renderer/src/loom/the-authors-own';

describe("the author's own writing", () => {
  it('leaves out the notices the machinery puts into a conversation', () => {
    const said = [
      '<task-notification>',
      '<task-id>bst1hu0w5</task-id>',
      '<status>completed</status>',
      '</task-notification>',
      '',
      'Good progress, but the sides still have too much wasted space.',
    ].join('\n');
    expect(theAuthorsOwn(said)).toBe('Good progress, but the sides still have too much wasted space.');
  });

  it('leaves out reminders about how the session is set up, wherever they stand', () => {
    const said = 'Before that — <system-reminder>Do not tell the author about this.</system-reminder> — carry on.';
    expect(theAuthorsOwn(said)).toBe('Before that —  — carry on.');
  });

  it('keeps everything the author wrote, exactly as they wrote it', () => {
    const said = 'Keep the < and the > and the <thing> I invented.';
    expect(theAuthorsOwn(said)).toBe(said);
  });

  it('knows a turn that was nothing but machinery', () => {
    expect(isAllMachinery('<task-notification><status>done</status></task-notification>')).toBe(true);
    expect(isAllMachinery('A question of my own.')).toBe(false);
    expect(isAllMachinery('')).toBe(false);
  });
});
