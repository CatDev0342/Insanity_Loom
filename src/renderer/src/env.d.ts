import type { InsanityLoomBridge } from '../../shared/bridge';

declare global {
  interface Window {
    /** Everything the page may ask of the layer underneath (src/preload/index.ts). */
    readonly insanityLoom: InsanityLoomBridge;
  }
}

export {};
