# Insanity_Loom

**A text editor for one author and an AI assistant, working in the same document.**

Insanity_Loom is a desktop text editor with a built-in conversation channel to Claude Code and other AI services. What
you write, and what your assistant writes back, is woven into a structure that works much like a wiki: pages, sections,
and links between them. The difference from a wiki is who owns the document. A wiki belongs to many contributors;
an Insanity_Loom document belongs to **one author**, working with an assistant.

> **Status: early design.** There is no code here yet. This page describes what is being built.

## The idea

You write. When you finish a section, you mark it finished, and your assistant reads it and replies in the document
itself, right where the conversation happened. No copying between a chat window and your notes, no losing four
paragraphs because a chat box ate them. The document is the conversation, and the conversation becomes the document.

## Principles

- **An application first.** Insanity_Loom behaves like a first-class desktop program: Tab and the arrow keys move
  where you expect, standard shortcuts do what they do everywhere else, and every key means what it should in the place
  you are working. Ctrl+Z undoes *your* typing; it never takes back your assistant's reply, and your assistant's
  undo never touches your words.
- **Rich-text editing without compromise.** Editing is the product. It has to be as dependable as the best word
  processors, on every platform it runs on.
- **One author, one assistant, one document.** Both work in the same live document at the same time. The author is
  its owner; the assistant is a co-author, never a co-owner.
- **Your files are yours.** Documents are plain files on your own disk, readable by any other editor, easy to back
  up and to keep under version control.
- **Local and web.** The same documents open in the desktop application and in a browser.
- **Windows and Linux.**

## Planned foundations

Built from proven open-source parts rather than reinvented ones:

| Part | Planned choice | License |
|---|---|---|
| Application shell | [Electron](https://www.electronjs.org/) — the same Chromium engine on every platform | MIT |
| Rich-text editing | [ProseMirror](https://prosemirror.net/) and [Tiptap](https://tiptap.dev/) | MIT |
| Assistant channel | [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol) — an open standard connecting editors to AI agents | Apache-2.0 |

Parts are chosen only under permissive licenses (MIT, Apache-2.0, BSD).

## License

Insanity_Loom is licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE).

Insanity_Loom is an independent project, not affiliated with or endorsed by Anthropic or any other AI provider.
"Claude" and "Claude Code" are trademarks of Anthropic.
