# Render Protocol

Prototype workspace for **v0 of the render surface** — an agent-native operator interface built on MCP and MCP Apps (SEP-1865).

This is a working artifact, not a product. It exists to be used and reacted to.

## Read these first

Before writing any code, the following context documents must be read in full. Drop them into `docs/` in the repo root:

| File | Purpose |
| --- | --- |
| [`docs/render_surface_design_document.md`](docs/render_surface_design_document.md) | The vision and design for the render surface |
| [`docs/research_base_levels.md`](docs/research_base_levels.md) | Competitive landscape and protocol context |
| [`docs/strategic_update.md`](docs/strategic_update.md) | Strategic position and what this prototype must demonstrate |

Until these three files exist in `docs/`, do not start proposing structure or writing code. They define the why; the rest of this README only sketches the what.

## What v0 must demonstrate

In priority order:

1. **Two-pane interface.** Persistent conversation panel on the left, render field on the right. Roughly 30/70 with the render field dominant.
2. **Composition over templates.** The render field assembles views from structured data using a primitive vocabulary: map, timeline, alert, narrative summary, table, live feed (mocked).
3. **`agent.md` / `user.md` configuration substrate.** Real markdown files in the repo, read on startup, governing defaults (what shows on open, what to surface, what requires approval). Editable and reloadable without restart.
4. **Honest MCP Apps integration.** Host calls an MCP server, receives structured data, renders UI resources via the `ui://` URI scheme per SEP-1865, and handles bidirectional JSON-RPC. A single mock MCP server is fine for v0 — the protocol must not be shortcut.
5. **Morning brief composition.** On open with the Personal agent loaded, the render field composes a default view from multiple "services" (mail flagged + recent, today's calendar, recent messages across chat apps, news from followed feeds, local weather, recently edited docs) before any user input. The agent writes a 2–3 sentence summary in the conversation panel.
6. **Recompose on change.** A new urgent email or a meeting starting in ten minutes reorganizes the render field: focus moves up, the relevant card highlights, the agent narrates the change in chat. Approve/reject on suggested actions is logged. All steps are observable and replayable in an audit log.

## Explicit non-goals for v0

Do not build, and stop and ask if reaching for any of these:

- Carrier layer (discovery, ranking, routing)
- Real-world integrations against live mail / calendar / messaging / news APIs (the mock MCP server stands in for all six "services")
- Real-time hard-latency guarantees
- Multi-tenant onboarding
- Payment integration (x402, ACP, MPP)
- Mobile, cross-device sync, accounts, auth
- A second operator domain (e.g. Legacy Cleanout)
- Public-demo polish

## Stack (planned)

- TypeScript / Node backend, MCP TypeScript SDK (`@modelcontextprotocol/sdk`)
- React / Next.js frontend
- Local-first; no cloud deployment
- Mock MCP server runs as a separate process (stdio or HTTP)
- Maps via Mapbox or Leaflet; charts via Recharts or similar
- SQLite for the audit log

## How we proceed

1. The three `docs/` files land in the repo.
2. A project structure is proposed (directory layout, key files, data flow, mock MCP shape, open architectural questions) — **no code yet**.
3. After agreement on structure, build incrementally so each step produces something runnable: two-pane shell → composition with mock data → honest MCP integration → morning brief → recompose-on-change scenario.

## Working norms

- Ask when assumptions are unclear.
- Push back on inconsistent or unrealistic requirements.
- Flag premature optimization or scope creep.
- Comments explain *why*, not *what*.
- After each piece, summarize briefly what was built and what's next.
