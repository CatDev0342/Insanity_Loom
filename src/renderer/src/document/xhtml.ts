// A whisper on disk: one XHTML file — the XML form of a web page — that opens in any browser as it is. Insanity_Loom
// writes it, reads it back strictly (a damaged file is reported, never half-read), and keeps what it needs to know
// about it in the page's head: its title, the program that wrote it, and the conversation it belongs to.

export const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/**
 * How a whisper looks when it is opened outside Insanity_Loom. It is carried in the file itself rather than left in a
 * stylesheet beside it, so a whisper sent to someone, copied onto a stick or kept in a backup still reads as itself,
 * with nothing to lose on the way. It says what Insanity_Loom says: a column of writing, the assistant's replies
 * marked down their left side, a section rule between them.
 */
const WHISPER_STYLE = `
      :root { color-scheme: dark light; }
      body {
        margin: 0;
        padding: 2rem 1rem;
        background: #1e1e22;
        color: #e8e6e3;
        font-family: system-ui, 'Segoe UI', Ubuntu, Cantarell, 'Noto Sans', sans-serif;
        line-height: 1.5;
      }
      article.whisper { max-width: 46rem; margin: 0 auto; }
      article.whisper h1, article.whisper h2, article.whisper h3 { line-height: 1.25; margin: 1.6em 0 0.4em; }
      article.whisper p { margin: 0 0 0.8em; }
      article.whisper a { color: #8fb0e8; }
      article.whisper code { font-family: ui-monospace, Consolas, 'DejaVu Sans Mono', monospace; }
      article.whisper pre { padding: 0.6rem 0.8rem; overflow-x: auto; background: #26262b; }
      article.whisper blockquote { margin: 0 0 0.8em; padding-left: 0.9rem; border-left: 3px solid #45454d; color: #9a978f; }
      article.whisper hr { height: 0; margin: 1.8em 0; border: 0; border-top: 1px solid #45454d; }
      article.whisper hr[data-turn] { position: relative; overflow: visible; }
      article.whisper hr[data-turn]::after {
        content: 'Turn ' attr(data-turn) ' · ' attr(data-shown);
        position: absolute;
        top: -0.75em;
        left: 0;
        padding-inline: 0.5rem;
        background: #1e1e22;
        color: #9a978f;
        font-size: 0.8rem;
      }
      article.whisper section[data-author='assistant'] {
        margin: 0 0 1em;
        padding: 0.7rem 0.9rem;
        border: 1px solid #b08a3e;
        border-left: 3px solid #4d6a9a;
        color: #cfd8e6;
      }
`;
const CONVERSATION_META = 'insanity-loom-conversation';
const GENERATOR = 'Insanity_Loom';

export interface WhisperFile {
  readonly title: string;
  /** The assistant's conversation this whisper records, or '' when it has none yet. */
  readonly conversationId: string;
  /** The whisper's content, as the editor's own HTML. */
  readonly bodyHtml: string;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Turns the editor's HTML into well-formed XHTML markup: every element closed, every attribute quoted. */
export function htmlToXhtmlFragment(html: string): string {
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  const serializer = new XMLSerializer();
  return [...parsed.body.childNodes].map((node) => serializer.serializeToString(node)).join('\n');
}

export function toXhtml(file: WhisperFile): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE html>',
    `<html xmlns="${XHTML_NAMESPACE}" lang="en">`,
    '<head>',
    '<meta charset="UTF-8" />',
    `<title>${escapeText(file.title)}</title>`,
    `<meta name="generator" content="${GENERATOR}" />`,
    `<meta name="${CONVERSATION_META}" content="${escapeAttribute(file.conversationId)}" />`,
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<style>${WHISPER_STYLE}    </style>`,
    '</head>',
    '<body>',
    '<article class="whisper">',
    htmlToXhtmlFragment(file.bodyHtml),
    '</article>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** Reads a whisper file. Throws, saying what is wrong, when it is not well-formed XHTML or not a whisper. */
export function fromXhtml(text: string): WhisperFile {
  const parsed = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  const failure = parsed.getElementsByTagName('parsererror')[0];
  if (failure !== undefined) {
    throw new Error(`The whisper is not well-formed XHTML: ${failure.textContent?.trim().split('\n')[0] ?? 'unknown error'}`);
  }
  // Selectors without a namespace match elements in any namespace, so these find the XHTML elements by name.
  const article = parsed.querySelector('article');
  if (article === null) throw new Error('The file is XHTML, but holds no whisper (no <article>).');
  const title = parsed.querySelector('title')?.textContent ?? '';
  const conversationId = parsed.querySelector(`meta[name="${CONVERSATION_META}"]`)?.getAttribute('content') ?? '';
  const serializer = new XMLSerializer();
  // The editor reads HTML: the article's children, as markup, are handed to it unchanged.
  const bodyHtml = [...article.childNodes].map((node) => serializer.serializeToString(node)).join('');
  return { title, conversationId, bodyHtml };
}
