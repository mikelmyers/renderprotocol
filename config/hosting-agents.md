# Hosting Agents

Carrier registry. Each `## ` heading is a hosting agent's id. Body lines
are `key: value` pairs the carrier reads. Hot-reloaded by the same
notify watcher that owns `agent.md` / `user.md`; adding or removing an
agent here takes effect without restarting the host.

Minimum required field: `endpoint`.

## alpha
endpoint: http://127.0.0.1:4717/mcp
description: Local mock alpha — full tool set including the widget UI app.

## beta
endpoint: http://127.0.0.1:4718/mcp
description: Local mock beta — subset specialist (lookup, get_alerts, get_recent_events).
