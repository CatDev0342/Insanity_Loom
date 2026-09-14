// A whisper on disk: one XHTML file — the XML form of a web page — that opens in any browser as it is. Insanity_Loom
// writes it, reads it back strictly (a damaged file is reported, never half-read), and keeps what it needs to know
// about it in the page's head: its title, the program that wrote it, and the conversation it belongs to.

export const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
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
