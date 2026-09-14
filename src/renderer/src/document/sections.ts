// Finding a finished section in a whisper: the author's writing between the rule that finished it and the boundary
// before it — the previous section rule, or the assistant's previous reply, or the start of the whisper.

import type { JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

const RULE = 'horizontalRule';
const REPLY = 'reply';

/** The top-level position of the section rule with this identity, or -1 when there is none. */
export function ruleIndex(doc: ProseMirrorNode, sectionId: string): number {
  let found = -1;
  doc.forEach((node, _offset, index) => {
    if (found === -1 && node.type.name === RULE && node.attrs['sectionId'] === sectionId) found = index;
  });
  return found;
}

/**
 * The author's blocks of the section finished by the rule with this identity, as a document of their own (for turning
 * into Markdown). Empty paragraphs are left out. Undefined when there is no such rule, or nothing written above it.
 */
export function sectionContent(doc: ProseMirrorNode, sectionId: string): JSONContent | undefined {
  const end = ruleIndex(doc, sectionId);
  if (end === -1) return undefined;
  const blocks: JSONContent[] = [];
  for (let index = end - 1; index >= 0; index--) {
    const node = doc.child(index);
    if (node.type.name === RULE || node.type.name === REPLY) break;
    if (node.type.name === 'paragraph' && node.textContent.trim() === '' && node.childCount === 0) continue;
    blocks.unshift(node.toJSON() as JSONContent);
  }
  return blocks.length === 0 ? undefined : { type: 'doc', content: blocks };
}

/** The position just after the section rule with this identity, where its reply belongs; -1 when there is no rule. */
export function afterRule(doc: ProseMirrorNode, sectionId: string): number {
  let position = -1;
  doc.forEach((node, offset) => {
    if (position === -1 && node.type.name === RULE && node.attrs['sectionId'] === sectionId) position = offset + node.nodeSize;
  });
  return position;
}

/** The position and node of the reply with this identity, or undefined. */
export function findReply(doc: ProseMirrorNode, replyId: string): { position: number; node: ProseMirrorNode } | undefined {
  let found: { position: number; node: ProseMirrorNode } | undefined;
  doc.forEach((node, offset) => {
    if (found === undefined && node.type.name === REPLY && node.attrs['replyId'] === replyId) found = { position: offset, node };
  });
  return found;
}

/** True when the whisper holds nothing but empty paragraphs. */
export function isBlank(doc: ProseMirrorNode): boolean {
  let blank = true;
  doc.forEach((node) => {
    if (!(node.type.name === 'paragraph' && node.childCount === 0)) blank = false;
  });
  return blank;
}
