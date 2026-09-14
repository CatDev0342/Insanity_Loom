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

Then tell Insanity_Loom where it is, in **Assistant ▸ Connection Settings** (the panel opens by itself the first
time). For a host in a container, for example:

| Option | Example | Means |
|---|---|---|
| Where the assistant runs | In a Docker container | |
| Docker program | `docker` | The Docker program: `docker` to find it on the PATH, or its full path. |
| Container | `my-assistant` | The running container's name. **Find Running** lists them. |
| Run as user | *(blank)* | The user inside the container; blank for the container's own default. |
| Working folder | `/home/me/project` | The folder, inside the container, the assistant works in. Conversations belong to it: Resume Conversation lists those begun there. |
| Host program | `/usr/local/bin/node` | The program that starts the host, inside the container. Use full paths: `docker exec` does not read the container's shell profile. |
| Arguments | `/home/me/Insanity_Loom/assistant-host/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js` | One per line. |

The panel shows the exact command it will run — `docker exec -i -w <working folder> <container> <host program>
<arguments…>` — and **Test Connection** tries it before anything is saved. Settings are kept only in the `Data` folder
beside the Insanity_Loom program.

## Running it on the same computer

Choose **Directly on this computer**; the working folder, host program and arguments are then those of this computer.
