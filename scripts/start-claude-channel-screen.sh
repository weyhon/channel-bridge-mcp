#!/bin/bash
set -euo pipefail

required=(CLAUDE_BIN CLAUDE_CHANNEL_PLUGIN CLAUDE_SESSION_ID CLAUDE_SETTINGS_FILE CLAUDE_CWD)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "missing required environment variable: $name" >&2
    exit 64
  fi
done

screen_name="${CLAUDE_SCREEN_NAME:-claude-channel}"
screen_list="$(screen -ls 2>&1 || true)"
if grep -q "[.]${screen_name}[[:space:]]" <<<"$screen_list"; then
  echo "screen session already running: $screen_name" >&2
  exit 1
fi

cd "$CLAUDE_CWD"
screen -DmS "$screen_name" \
  "$CLAUDE_BIN" \
  --dangerously-skip-permissions \
  --dangerously-load-development-channels "$CLAUDE_CHANNEL_PLUGIN" \
  --resume "$CLAUDE_SESSION_ID" \
  --setting-sources project,local \
  --settings "$CLAUDE_SETTINGS_FILE" \
  --no-chrome \
  </dev/null >/dev/null 2>&1

sleep 5
screen -S "$screen_name" -p 0 -X stuff $'\015'
echo "started detached screen: $screen_name"
