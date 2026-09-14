// The leash the page runs on, and the things that must never quietly come undone.
//
// These are not tests of clever code; they are tests that a setting has not been changed by someone in a hurry. Each
// one is a door that, left open, would let a page reach past the program and into the author's machine.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_PREFERENCES } from '../../src/main/security';

const REPOSITORY = join(__dirname, '..', '..');

describe('the page runs on a short leash', () => {
  it('cannot reach Node.js, cannot leave its own context, and is sandboxed', () => {
    expect(PAGE_PREFERENCES.nodeIntegration).toBe(false);
    expect(PAGE_PREFERENCES.nodeIntegrationInWorker).toBe(false);
    expect(PAGE_PREFERENCES.contextIsolation).toBe(true);
    expect(PAGE_PREFERENCES.sandbox).toBe(true);
  });

  it("keeps the browser's own protections on", () => {
    expect(PAGE_PREFERENCES.webSecurity).toBe(true);
    expect(PAGE_PREFERENCES.allowRunningInsecureContent).toBe(false);
    expect(PAGE_PREFERENCES.experimentalFeatures).toBe(false);
    expect(PAGE_PREFERENCES.webviewTag).toBe(false);
  });
});

describe('every page Insanity_Loom shows', () => {
  const pages = ['src/renderer/index.html', 'src/renderer/find.html'];

  it('says what it may load, and may load nothing from anywhere else', () => {
    for (const page of pages) {
      const html = readFileSync(join(REPOSITORY, page), 'utf8');
      expect(html, page).toContain("default-src 'self'");
      expect(html, page).toContain("script-src 'self'");
      expect(html, page).toContain("object-src 'none'");
      expect(html, page).toContain("frame-ancestors 'none'");
      // A page that could be talked into running a string is a page that can be talked into anything.
      expect(html, page).not.toContain("script-src 'self' 'unsafe-inline'");
      expect(html, page).not.toContain('unsafe-eval');
    }
  });
});

describe('the built program', () => {
  it('cannot be turned into something else by its own fuses', () => {
    const packaging = readFileSync(join(REPOSITORY, 'electron-builder.yml'), 'utf8');
    expect(packaging).toContain('runAsNode: false');
    expect(packaging).toContain('enableNodeOptionsEnvironmentVariable: false');
    expect(packaging).toContain('enableNodeCliInspectArguments: false');
    expect(packaging).toContain('enableCookieEncryption: true');
  });
});
