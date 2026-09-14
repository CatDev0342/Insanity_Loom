// Whether opening a whisper lost any of it: what the file said, weighed against what the whisper holds.
import { describe, expect, it } from 'vitest';
import { whatWasLost, writingIn } from '../../src/renderer/src/loom/nothing-lost';

describe('what a whisper holds', () => {
  it('is the writing, not the markup around it', () => {
    expect(writingIn('<head><title>A name</title></head><p>The <strong>writing</strong>.</p>')).toBe('The writing .');
  });

  it('is not lost when the markup changes but the writing does not', () => {
    const file = '<article class="whisper"><p>The first line.</p><p>The second line.</p></article>';
    const whisper = '<p>The first line.</p><p>The second line.</p>';
    expect(whatWasLost(file, whisper).lost).toBe(false);
  });

  it('is lost when the editor could not read part of it', () => {
    const file = '<p>The first line.</p><table><tr><td>A table the editor does not know.</td></tr></table><p>The last line.</p>';
    const whisper = '<p>The first line.</p><p>The last line.</p>';
    const lost = whatWasLost(file, whisper);
    expect(lost.lost).toBe(true);
    expect(lost.share).toBeGreaterThan(0.2);
  });

  it('counts a picture lost as a loss, whatever the words say', () => {
    const file = '<p>A line.</p><p><img src="a.png" alt="a picture" /></p>';
    expect(whatWasLost(file, '<p>A line.</p><p></p>').lost).toBe(true);
    expect(whatWasLost(file, file).lost).toBe(false);
  });

  it('says nothing was lost from an empty whisper', () => {
    expect(whatWasLost('', '<p></p>')).toEqual({ lost: false, share: 0 });
  });
});
