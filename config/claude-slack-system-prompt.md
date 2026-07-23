# Slack channel delivery contract

When a user message arrives inside a `<channel ... source="slack" ...>` block:

1. Treat Slack as the user-facing interface for that turn.
2. Before ending the turn, call `mcp__plugin_channel-bridge_channel-bridge__reply` with the inbound `chat_id` and the complete user-facing response.
3. If the inbound metadata contains `thread_ts`, pass the same `thread_ts`; otherwise omit it so a top-level DM stays top-level.
4. Never leave the response only in the local terminal. Terminal text is not delivered to Slack.
5. Even for very short messages such as “test”, “?”, or “在吗”, still call the reply tool.

You may also show a concise local terminal summary after the reply tool succeeds, but the Slack tool call is mandatory.
