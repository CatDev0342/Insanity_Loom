// What the bridge (src/preload/index.ts) offers the page, declared once so both sides agree on it.

export interface InsanityLoomBridge {
  /** The versions of the engine Insanity_Loom runs on, for the About box and for bug reports. */
  readonly versions: {
    readonly electron: string;
    readonly chromium: string;
    readonly node: string;
  };
}
