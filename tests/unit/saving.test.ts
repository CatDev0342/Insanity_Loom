// When the whisper reaches its file. Every change is saved at once; changes made while a save is being written are
// gathered into the next; a change made while the whisper is between files waits for the file rather than stopping
// saving for good; and whoever moves the file waits for the save in flight to finish first.
import { describe, expect, it } from 'vitest';
import { Saving } from '../../src/renderer/src/loom/saving';

/** Lets everything already waiting carry on, so what a save did next can be looked at. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** A file that is slow to write, so that what happens during a save can be watched. */
function heldWrite(): {
  readonly saving: Saving;
  readonly written: string[];
  readonly problems: string[];
  /** Lets the write now in flight finish. */
  readonly finish: () => void;
} {
  const written: string[] = [];
  const problems: string[] = [];
  let letGo: (() => void) | undefined;
  const saving = new Saving({
    write: async (path) => {
      written.push(path);
      await new Promise<void>((resolve) => {
        letGo = resolve;
      });
    },
    onProblem: (message) => problems.push(message),
  });
  return { saving, written, problems, finish: () => letGo?.() };
}

describe('saving the whisper', () => {
  it('writes it at once when it changes', async () => {
    const { saving, written, finish } = heldWrite();
    saving.useFile('a.xhtml');
    saving.changed();
    expect(written).toEqual(['a.xhtml']);
    finish();
    await saving.stop();
  });

  it('gathers changes made while a save is being written into the next one', async () => {
    const { saving, written, finish } = heldWrite();
    saving.useFile('a.xhtml');
    saving.changed();
    saving.changed();
    saving.changed();
    // Still the one write: the rest are waiting for it.
    expect(written).toEqual(['a.xhtml']);
    finish();
    await settle();
    expect(written).toEqual(['a.xhtml', 'a.xhtml']);
    finish();
    await saving.stop();
  });

  it('goes on saving after a change made while the whisper is between files', async () => {
    const { saving, written, finish } = heldWrite();
    // Between files: a new whisper is being made, or another opened. There is nothing to write to.
    saving.changed();
    expect(written).toEqual([]);

    saving.useFile('a.xhtml');
    saving.changed();
    expect(written).toEqual(['a.xhtml']);
    finish();
    await saving.stop();
  });

  it('waits for the save in flight before letting the file be moved, and takes it away', async () => {
    const { saving, written, finish } = heldWrite();
    saving.useFile('a.xhtml');
    saving.changed();

    let stopped = false;
    const stopping = saving.stop().then((path) => {
      stopped = true;
      return path;
    });
    await settle();
    // The save is still being written, so nothing may move the file yet.
    expect(stopped).toBe(false);

    finish();
    expect(await stopping).toBe('a.xhtml');
    // The file has been taken away: a change now waits for wherever the whisper lands.
    saving.changed();
    expect(written).toEqual(['a.xhtml']);
    expect(saving.file).toBe('');
  });

  it('says so when a save fails, and saves again afterwards', async () => {
    const written: string[] = [];
    const problems: string[] = [];
    let refuse = true;
    const saving = new Saving({
      write: async (path) => {
        if (refuse) throw new Error('the disk is full');
        written.push(path);
        return Promise.resolve();
      },
      onProblem: (message) => problems.push(message),
    });
    saving.useFile('a.xhtml');
    saving.changed();
    await saving.stop();
    expect(problems[0]).toContain('the disk is full');

    refuse = false;
    saving.useFile('a.xhtml');
    saving.changed();
    await saving.stop();
    expect(written).toEqual(['a.xhtml']);
  });
});
