# Insanity_Loom assistant host

The assistant host runs **where the assistant runs** — inside a Docker container, or on the same computer as
Insanity_Loom — and speaks the [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol)
with Insanity_Loom over its standard input and output.

Today the host is Claude's ACP adapter, [`@agentclientprotocol/claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp),
which drives Claude Code through the Claude Agent SDK. It uses the Claude Code sign-in already present where it runs;
Insanity_Loom never sees credentials.

The host is **not part of the Insanity_Loom program** and is not shipped with it. It is installed separately, where the
assistant lives, and its packages come under their own licenses.

## Setting it up in a Docker container

Inside the container (Node.js 24 or later required):

```sh
cd /path/to/Insanity_Loom/assistant-host
npm ci
```

Then point Insanity_Loom at it in `Data/settings.json`, beside the Insanity_Loom program:

```json
{
  "assistant": {
    "kind": "docker",
    "container": "my-assistant",
    "workingFolder": "/home/me/project",
    "hostCommand": [
      "/usr/local/bin/node",
      "/home/me/Insanity_Loom/assistant-host/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js"
    ]
  }
}
```

- `container` — the running container's name.
- `workingFolder` — the folder, inside the container, the assistant works in. Conversations belong to it: Resume
  Conversation lists those begun in this folder.
- `hostCommand` — the program that starts the host, inside the container, then its arguments. Full paths: `docker
  exec` does not read the container's shell profile.

Insanity_Loom runs `docker exec -i -w <workingFolder> <container> <hostCommand…>` itself; Docker Desktop must be
running and `docker` on the PATH.

## Running it on the same computer

Set `"kind": "local"`, drop `container`, and give `hostCommand` as it runs on that computer; `workingFolder` is then a
folder on that computer.
