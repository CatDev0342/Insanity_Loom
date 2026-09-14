// What the program refuses to let Chromium do on its own account.
import { describe, expect, it } from 'vitest';
import { keepChromiumToItself, PRIVACY_SWITCHES } from '../../src/main/privacy';
import type { App } from 'electron';

describe('keeping Chromium to itself', () => {
  it('switches off what a browser does for its maker rather than for its author', () => {
    const named = PRIVACY_SWITCHES.map((one) => one.switch);
    // The ones that matter most: nothing fetched when idle, nothing synced, no statistics, no crash reports outward.
    expect(named).toContain('disable-background-networking');
    expect(named).toContain('disable-sync');
    expect(named).toContain('metrics-recording-only');
    expect(named).toContain('disable-breakpad');
    // Every switch says what it stops, so the list can be read by someone who is not a browser engineer.
    for (const one of PRIVACY_SWITCHES) expect(one.stops.length).toBeGreaterThan(10);
  });

  it('gives each of them to Chromium, with their values where they have one', () => {
    const given: { name: string; value?: string }[] = [];
    const app = {
      commandLine: {
        appendSwitch: (name: string, value?: string) => given.push(value === undefined ? { name } : { name, value }),
      },
    } as unknown as App;

    keepChromiumToItself(app);
    expect(given).toHaveLength(PRIVACY_SWITCHES.length);
    expect(given).toContainEqual({ name: 'disable-sync' });
    expect(given.find((one) => one.name === 'disable-features')?.value).toContain('Translate');
  });
});
