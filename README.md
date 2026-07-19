# Channel Bridge MCP

An independent messaging-channel bridge for Claude Code, built on MCP. The
first adapter is Slack Socket Mode; Discord, Telegram, and Lark adapters are
planned behind the same channel interface.

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

This is a channel MCP server, not a model proxy. Inbound messages are emitted
with the experimental `claude/channel` capability. Outbound actions are MCP
tools: `reply`, `react`, `edit_message`, `fetch_messages`, and
`download_attachment`.

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
```

Then protect it:

```bash
chmod 600 ~/.claude/channels/channel-bridge/.env
```

Copy `config/access.example.json` to
`~/.claude/channels/channel-bridge/access.json`, replace the sample Slack IDs,
and set mode `600`.

## Run with Claude Code

For local development, add this repository as a Claude Code plugin or register
its `.mcp.json`, then launch Claude Code with the channel enabled:

```bash
claude --channels plugin:channel-bridge@your-marketplace
```

The exact install command depends on the marketplace/repository publishing
method. During development, `npm run dev` can validate Slack connectivity and
`npm test` validates the access gate.

## Roadmap

- [x] MCP channel capability and inbound Slack notifications
- [x] Slack reply/react/edit/history/attachment tools
- [x] Allowlist and mention/thread policy
- [ ] Pairing command and runtime access management
- [ ] Permission-request buttons from phone
- [ ] Discord adapter
- [ ] Telegram adapter
- [ ] Lark/Feishu adapter
- [ ] Adapter contract and conformance test suite
- [ ] Installable Claude Code marketplace package

## Security

Never commit `.env`, bot tokens, downloaded attachments, or runtime state.
Use a dedicated low-privilege bot for development. The bridge enforces both a
user allowlist and a channel allowlist before delivering content to Claude.

## License

MIT
