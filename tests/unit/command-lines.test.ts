// What a command is called in the Commands tab (src/renderer/src/loom/command-lines.ts).
import { describe, expect, it } from 'vitest';
import { workOfACommand } from '../../src/renderer/src/loom/command-lines';

describe('naming a command', () => {
  it('puts aside the setting of a variable and shows the work', () => {
    expect(workOfACommand('export PATH="$HOME/work/tools/node/bin:$PATH"; npx eslint .')).toBe('npx eslint .');
  });

  it('puts aside going to a folder', () => {
    expect(workOfACommand('cd ~/work/Insanity_Loom && npm run check')).toBe('npm run check');
  });

  it('puts aside every step of getting ready, one after another', () => {
    const whole = 'export PATH="$HOME/bin:$PATH"; cd ~/work/Insanity_Loom && git status';
    expect(workOfACommand(whole)).toBe('git status');
  });

  it('keeps a command that is only getting ready — there is nothing else in it to say', () => {
    expect(workOfACommand('cd ~/work/Insanity_Loom')).toBe('cd ~/work/Insanity_Loom');
    expect(workOfACommand('cd /tmp &&')).toBe('cd /tmp &&');
  });

  it('brings a command written over several lines onto one', () => {
    expect(workOfACommand('grep -n "a"  \n  src/main.ts')).toBe('grep -n "a" src/main.ts');
  });

  it('never cuts a command short, however long it is', () => {
    // A cut line loses the very part that says which command it was: two reads of two different files both read
    // "Read File" (the designer, 2026-Sep-16). The panel scrolls sideways instead.
    const long = `echo ${'x'.repeat(200)}`;
    expect(workOfACommand(long)).toBe(long);
  });

  it('leaves alone a command with no getting ready in it', () => {
    expect(workOfACommand('for i in $(seq 1 3); do echo $i; done')).toBe('for i in $(seq 1 3); do echo $i; done');
  });

});
