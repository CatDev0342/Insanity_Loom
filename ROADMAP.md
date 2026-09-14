# Insanity_Loom — Roadmap

The author steers; the assistant builds. Each milestone ends in something the author can use, not just read about.

## Vocabulary

| Word | Means |
|---|---|
| **Whisper** | A page. |
| **Alcove** | A folder of whispers. |
| **GreatHall** | A collection of connected alcoves. |
| **Author** | The one person who owns the document. |
| **Assistant** | The AI working in it with them — a co-author, never a co-owner. |

## How the work is done

- TypeScript throughout, strictly checked. Commits go straight to `main`.
- Every change is tested automatically on **Windows and Linux** (GitHub Actions). A change that fails on either does
  not stay.
- The author tries each milestone and gives the verdict.

## Milestones

### 0. Foundation — done
An empty Insanity_Loom window that opens on Windows and Linux.
- Electron with its security settings on from day one: the window that shows the page cannot touch files; only the
  layer underneath can.
- Automated tests: unit tests of the parts, and end-to-end runs that open the real application and type into it.
- **Portable, no installer.** Unzip anywhere and double-click. Settings, caches and everything else the application
  keeps live in a `Data` folder beside the executable — nothing in the user profile, nothing in the registry.
  Windows: a folder with `Insanity_Loom.exe`. Linux: an AppImage (or a folder), with its `Data` folder beside it.
- **A license check on every build**: any GPL or AGPL part is refused, and the third-party notices file is generated
  automatically.

### 1. Walking skeleton — the channel works — done
A plain editor with the assistant connected. From here on, the author talks to the assistant through Insanity_Loom.
- The author writes and closes the turn (Ctrl+Enter).
- A small host where the assistant runs passes the section on and streams the reply back into the document as it is
  written.
- Approve / Deny in the application for anything the assistant needs permission for.
- **Nothing typed is ever lost.** Every keystroke is journaled to disk first; after a crash or a power cut the
  application reopens where the author was.
- **Connecting is one click, and after the first time, none.** Every connection option is on show in Assistant ▸
  Connection Settings, which opens by itself on the first start. There is no folder-trust prompt.
- **Signing in happens inside Insanity_Loom, and only when the author asks.** When the assistant is not signed in,
  the status bar says so and offers Sign In; the Sign In panel starts the assistant's own sign-in, opens the sign-in
  page in the browser at the press of a button, and takes the code the page shows. The assistant keeps the sign-in
  where it runs; Insanity_Loom never sees a password or holds a credential.

### 2. Real editing
One document: the author writes anywhere in the whisper, and the assistant answers at the end of it — the
conversation has a horizon, and writing further up is theirs to change and is never sent again. A turn is closed with
Ctrl+Enter, and nothing else; each turn is numbered and carries the local date and time it was taken. Each
conversation is a whisper, saved as XHTML. Rich text on ProseMirror and Tiptap, held to the standard
of the best word processors.
- Desktop-grade keys: Tab, arrows, standard shortcuts; every key means what it should where the author is working.
- The assistant's replies are the author's to edit, like any of their own text, while staying marked as the
  assistant's. Separate undo: the author's Ctrl+Z never takes back the assistant's writing, and the reverse.
- The assistant's replies are anchored to the section they answer, so they land in the right place while the author
  types elsewhere.
- Heavy automated testing of typing, pasting and undo, including thousands of random editing sequences.

### 3. The wiki
Whispers, alcoves and GreatHalls; sections with IDs that survive renames and moves; links between whispers and
sections; backlinks; search.

### 4. Local only
No web half, and none wanted: a whisper is an XHTML file carrying its own look, so it opens in any browser straight
from the alcove, with its links working. Nothing is served over a network.

### 5. Polish
Very large documents, accessibility, updates.

## The assistant channel

Insanity_Loom talks to an assistant in two directions, as a code editor's AI integration does:

- **The application drives the assistant** — starts a session, sends what the author wrote, receives the reply as it
  streams, answers permission requests. The open standard for this is the
  [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol) (ACP); Claude Code joins
  through its ACP adapter, and other ACP agents can join the same way.
- **The assistant works in the document** — reads whispers, sees the author's selection, writes its reply at the
  right place. The open standard for this is the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP):
  Insanity_Loom offers these abilities as an MCP server the assistant connects to.

The assistant may run somewhere else — in a Docker container, say — so the host sits beside it and the application
connects to the host.

## How whispers are stored

**Each whisper is one XHTML file** — the XML form of a web page, limited to a strict set of elements Insanity_Loom
defines. Real XML, so it is checked on every load and a damaged file is reported, never half-read. It opens in any
browser as it is, which is local and web interop done by the file itself. ProseMirror reads and writes it natively.
Sections carry IDs, so a link to `other-whisper.xhtml#section-id` is an ordinary web link. Markdown export is kept for
other tools.
