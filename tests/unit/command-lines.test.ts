// What a command is called in the Commands tab (src/renderer/src/loom/command-lines.ts).
import { describe, expect, it } from 'vitest';
import { sameCommand, shortCommand, timesOver } from '../../src/renderer/src/loom/command-lines';

describe('naming a command', () => {
  it('puts aside the setting of a variable and shows the work', () => {
    expect(shortCommand('export PATH="$HOME/work/tools/node/bin:$PATH"; npx eslint .')).toBe('npx eslint .');
  });

  it('puts aside going to a folder', () => {
    expect(shortCommand('cd ~/work/Insanity_Loom && npm run check')).toBe('npm run check');
  });

  it('puts aside every step of getting ready, one after another', () => {
    const whole = 'export PATH="$HOME/bin:$PATH"; cd ~/work/Insanity_Loom && git status';
    expect(shortCommand(whole)).toBe('git status');
  });

  it('keeps a command that is only getting ready — there is nothing else in it to say', () => {
    expect(shortCommand('cd ~/work/Insanity_Loom')).toBe('cd ~/work/Insanity_Loom');
    expect(shortCommand('cd /tmp &&')).toBe('cd /tmp &&');
  });

  it('brings a command written over several lines onto one', () => {
    expect(shortCommand('grep -n "a"  \n  src/main.ts')).toBe('grep -n "a" src/main.ts');
  });

  it('cuts a very long command short, and says it did', () => {
    const long = `echo ${'x'.repeat(200)}`;
    const shown = shortCommand(long);
    expect(shown.length).toBeLessThanOrEqual(72);
    expect(shown.endsWith('…')).toBe(true);
  });

  it('leaves alone a command with no getting ready in it', () => {
    expect(shortCommand('for i in $(seq 1 3); do echo $i; done')).toBe('for i in $(seq 1 3); do echo $i; done');
  });

  it('knows two commands are the same work behind different setups', () => {
    expect(sameCommand('export PATH="/a:$PATH"; npm run check', 'cd ~/work && npm run check')).toBe(true);
    expect(sameCommand('npm run check', 'npm run build')).toBe(false);
  });
});

describe('counting a run of the same command', () => {
  it('says nothing about the first', () => {
    expect(timesOver(1)).toBe('');
  });

  it('counts the rest', () => {
    expect(timesOver(3)).toBe('× 3');
  });
});
