import { describe, expect, it } from 'vitest';
import { finishedSectionAt } from '../../src/renderer/src/loom/sections';

describe('finishedSectionAt', () => {
  it('finishes the section when Enter is pressed at the end of a --- line', () => {
    const text = 'First thought.\nSecond line.\n---';
    expect(finishedSectionAt(text, text.length)).toEqual({ section: 'First thought.\nSecond line.', remaining: '' });
  });

  it('keeps writing that follows the mark', () => {
    const text = 'Done here.\n---\nand this stays';
    const caret = text.indexOf('---') + '---'.length;
    expect(finishedSectionAt(text, caret)).toEqual({ section: 'Done here.', remaining: 'and this stays' });
  });

  it('ignores spaces around the mark', () => {
    const text = 'Words.\n  ---  ';
    expect(finishedSectionAt(text, text.length)?.section).toBe('Words.');
  });

  it('is ordinary writing when the caret is not at the end of the mark', () => {
    const text = 'Words.\n---';
    expect(finishedSectionAt(text, text.length - 1)).toBeUndefined();
  });

  it('is ordinary writing when the line holds anything else', () => {
    const text = 'Words.\n--- no';
    expect(finishedSectionAt(text, text.length)).toBeUndefined();
    const dashes = 'Words.\n----';
    expect(finishedSectionAt(dashes, dashes.length)).toBeUndefined();
  });

  it('does not send an empty section', () => {
    expect(finishedSectionAt('\n\n---', 5)).toBeUndefined();
    expect(finishedSectionAt('---', 3)).toBeUndefined();
  });
});
