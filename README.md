# Channel Bridge MCP

An independent messaging-channel bridge for Claude Code and Codex. The first
adapter is Slack Socket Mode; Discord, Telegram, and Lark adapters are planned
behind the same channel interface.

## Architecture

```text
Slack Events API (Socket Mode)
          |
          v
Access policy + thread gate
          |
          v
notifications/claude/channel ---> Claude Code
          ^                           |
          |                           v
      Slack Web API <--------- MCP tools
```

The bridge has two runtime modes:

- `BRIDGE_RUNTIME=claude`: inbound messages are emitted with the experimental
  `claude/channel` MCP capability. Outbound actions are MCP tools.
- `BRIDGE_RUNTIME=codex`: the bridge starts `codex app-server`, maps each Slack
  thread to a persistent Codex thread, streams the turn, and posts the final
  answer back to Slack.

## Current behavior

- Only allowlisted Slack users and channels can trigger the bridge.
- A top-level channel message must mention the bot by default.
- Follow-up messages inside a thread started with the bot do not need another
  mention.
- Direct messages are accepted only from allowlisted users.
- Attachment metadata is delivered immediately; bytes are downloaded only
  when Claude calls `download_attachment`.
- Tokens and runtime state stay outside the repository.

## Slack application

Create a Slack app with Socket Mode enabled.

Bot scopes:

- `app_mentions:read`
- `channels:history`
- `chat:write`
- `files:read`
- `im:history`
- `reactions:read`
- `reactions:write`
- `users:read`

Bot events:

- `app_mention`
- `message.channels`
- `message.im`

Create an App-Level Token with `connections:write`.

## Install

```bash
npm install
npm run build
```

Create the state directory:

```bash
mkdir -p ~/.claude/channels/channel-bridge
chmod 700 ~/.claude/channels/channel-bridge
```

Create `~/.claude/channels/channel-bridge/.env`:

```dotenv
SLACK_BOT_TOKEN=xoxb-REPLACE_ME
SLACK_APP_TOKEN=xapp-REPLACE_ME
BRIDGE_RUNTIME=claude
```

Then protect it:

```bash
chmod 600 ~/.claude/channels/channel-bridge/.env
```

Copy `config/access.example.json` to
`~/.claude/channels/channel-bridge/access.json`, replace the sample Slack IDs,
and set mode `600`.

## Run with Claude Code

Register this repository as a local Claude Code marketplace and install the
plugin:

```bash
claude plugin marketplace add /absolute/path/to/channel-bridge-mcp
claude plugin install channel-bridge@weyhon-channel-bridge --scope user
```

Because this is a self-developed channel rather than an Anthropic-approved
channel, launch it with the explicit development-channel gate:

```bash
claude --dangerously-load-development-channels \
  plugin:channel-bridge@weyhon-channel-bridge
```

Claude Code displays a confirmation screen before loading a development
channel. Only confirm code you own and have reviewed. The Slack user/channel
allowlists remain enforced after this gate is enabled. During development,
`npm run dev` validates Slack connectivity and `npm test` validates the access
gate.

## Run with Codex

Codex mode uses the local Codex login and the official app-server JSON-RPC
protocol. Add these values to the same protected `.env` file:

```dotenv
BRIDGE_RUNTIME=codex
CODEX_BIN=/absolute/path/to/codex
CODEX_CWD=/absolute/path/to/workspace
CODEX_APPROVAL_POLICY=never
CODEX_SANDBOX=workspace-write
CODEX_REASONING_EFFORT=high
CODEX_DEVELOPER_INSTRUCTIONS=Reply in the user's preferred language and confirm destructive or external side effects.
```

Then run:

```bash
npm run build
npm run start:codex
```

The unattended default is `workspace-write` plus `never`: Codex can work in the
configured workspace, while operations requiring elevated approval fail rather
than hanging. Full-machine access is explicitly opt-in with
`CODEX_SANDBOX=danger-full-access` and should only be used with strict Slack
user/channel allowlists.

Codex app-server bindings are version-specific. Regenerate local reference
schemas after upgrading Codex:

```bash
./scripts/generate-codex-schema.sh
```

### Run Codex as a macOS service

Use a separate state directory for each bot so Slack credentials, owned-thread
state, and Codex thread mappings never overlap:

```bash
export CHANNEL_BRIDGE_STATE_DIR="$HOME/.claude/channels/codex-mini"
```

Build the project, create `$CHANNEL_BRIDGE_STATE_DIR/logs`, and copy
`config/macos-launch-agent.example.plist` into `~/Library/LaunchAgents/`.
Replace every `__PLACEHOLDER__` with an absolute path before loading it:

```bash
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.example.channel-bridge.codex-mini.plist"
```

The service template uses `RunAtLoad` and `KeepAlive`, so it reconnects after a
login or an unexpected process exit. Keep the previous service disabled but
undeleted during migration; rollback should only require booting out the new
label and re-enabling the old one.

Existing Slack threads can be migrated by writing their owned root keys to
`threads.json` and their Codex thread IDs to `codex-threads.json`:

```json
{
  "C0123456789:1234567890.123456": "019f-example-codex-thread-id"
}
```

Only migrate threads whose root message explicitly mentioned this bot. This
prevents one bot from treating another bot's thread as its own.

### Slack conversation routing

- A top-level channel message must mention the bot. The bridge replies in a
  thread and keeps that Slack thread mapped to one agent session.
- A top-level direct message replies in the main DM timeline and all top-level
  messages in that DM share one continuous agent session.
- If the user deliberately opens a thread inside a DM, the bridge preserves
  that thread as a separate session.

## Roadmap

- [x] MCP channel capability and inbound Slack notifications
- [x] Slack reply/react/edit/history/attachment tools
- [x] Allowlist and mention/thread policy
- [x] Codex app-server runtime with persistent Slack-to-Codex thread mapping
- [x] Slack image/file forwarding to Codex
- [ ] Pairing command and runtime access management
- [ ] Permission-request buttons from phone
- [ ] Discord adapter
- [ ] Telegram adapter
- [ ] Lark/Feishu adapter
- [ ] Adapter contract and conformance test suite
- [x] Installable Claude Code marketplace package

## Security

Never commit `.env`, bot tokens, downloaded attachments, or runtime state.
Use a dedicated low-privilege bot for development. The bridge enforces both a
user allowlist and a channel allowlist before delivering content to Claude.

## License

MIT
