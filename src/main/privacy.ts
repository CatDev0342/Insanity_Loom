// What Insanity_Loom tells the world about its author: nothing.
//
// Chromium is built to be a browser, and a browser talks to its maker — checking for variations to try, updating its
// safe-browsing lists, reporting how it crashed, offering to translate, looking for casting devices on the network.
// None of that belongs in a program that holds someone's private writing, so it is switched off here, before Chromium
// starts (the switches are only read at startup).
//
// What Insanity_Loom does reach out for, it does because the author asked: the assistant it is connected to, a link
// they followed, and the spelling dictionaries Chromium fetches when they turn spelling on for a language (50.2a.2).

import type { App } from 'electron';

/**
 * The switches, each with what it stops. They are given as a list rather than as a line of code so that what the
 * program refuses to do can be read, and tested, without starting it.
 */
export const PRIVACY_SWITCHES: readonly { readonly switch: string; readonly value?: string; readonly stops: string }[] = [
  { switch: 'disable-background-networking', stops: 'everything Chromium fetches on its own account when idle' },
  { switch: 'disable-sync', stops: 'signing in to a browser account and syncing anything anywhere' },
  { switch: 'disable-domain-reliability', stops: 'reporting failed requests to Google' },
  { switch: 'no-pings', stops: 'the hyperlink auditing pings a page can ask a browser to send' },
  { switch: 'disable-breakpad', stops: 'sending crash reports outward; crashes are kept beside the program instead' },
  { switch: 'metrics-recording-only', stops: 'usage statistics leaving the machine' },
  { switch: 'disable-client-side-phishing-detection', stops: 'the model downloads that come with safe browsing' },
  {
    switch: 'disable-features',
    value: 'Translate,MediaRouter,OptimizationHints,InterestFeedContentSuggestions,CalculateNativeWinOcclusion',
    stops: 'translation offers, casting to devices on the network, and the hint downloads that feed them',
  },
];

/** Switches every one of them on, before Chromium starts. */
export function keepChromiumToItself(app: App): void {
  for (const { switch: name, value } of PRIVACY_SWITCHES) {
    if (value === undefined) app.commandLine.appendSwitch(name);
    else app.commandLine.appendSwitch(name, value);
  }
}
