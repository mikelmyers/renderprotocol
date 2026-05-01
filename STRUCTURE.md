# STRUCTURE.md

The agreed v0 shape for the render surface. Captures decisions made before code was written so future-me (and any collaborator) can read the intent without reverse-engineering it.

Status: locked for v0. Updates require an explicit decision, not drift.

---

## 1. Stack

- **Tauri 2.0** desktop application. Rust backend, React frontend. Single window, single page.
- **React + Vite + TypeScript** on the frontend. No Next.js. No SSR. Local-only.
- **pnpm workspaces** for the monorepo.
- **Rust** for the backend: holds the JSON-RPC 2.0 connection to MCP servers, manages the Node mock-server sidecar, watches `config/`, owns the audit log, owns the surface event bus.
- **Node** sidecar runs the mock MCP server using `@modelcontextprotocol/sdk` over Streamable HTTP.
- **Leaflet + OpenStreetMap** for maps. **Recharts** for timelines. **Zustand** for UI state. **TanStack Query** for IPC-backed data with a custom Tauri queryFn. **better-sqlite3 / rusqlite** for the audit log.

## 2. Protocols

Only **MCP core** and **MCP Apps (SEP-1865)** are in v0. Everything else (Tasks SEP-1686, MCP auth/OAuth, ACP, MPP, x402, TAP, Stripe Link Agent Wallet, our own carrier protocol) is `[later]` and slots in via the `protocols/` adapter pattern with no restructuring.

Where the JSON-RPC client lives: **Rust holds the connection.** The TS SDK is used on the frontend only for the iframe-side bits of MCP Apps (`postMessage` envelope between `McpAppFrame` and the host). All tool calls, all notifications, all audit logging consolidated in Rust.

rmcp spike (timeboxed 2-3 hours): if rmcp covers MCP core but not SEP-1865, mix — rmcp for core, custom for SEP-1865. If rmcp is absent or insufficient, custom thin Rust JSON-RPC 2.0 client for everything.

## 3. Directory layout

```
renderprotocol/
├── README.md
├── STRUCTURE.md                            # this file
├── docs/
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── .gitignore
│
├── config/                                 # live config; Rust watches via `notify`
│   ├── user.md
│   └── agents/primordia-ops.md
│
├── apps/
│   ├── host/                               # the Tauri app
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   ├── index.html
│   │   ├── src/                            # React frontend
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx                     # two-pane shell, 30/70
│   │   │   ├── components/
│   │   │   │   ├── conversation/
│   │   │   │   │   ├── ConversationPanel.tsx
│   │   │   │   │   ├── MessageList.tsx
│   │   │   │   │   ├── ReferenceChip.tsx
│   │   │   │   │   ├── ContextChip.tsx
│   │   │   │   │   └── Composer.tsx
│   │   │   │   ├── render-field/
│   │   │   │   │   ├── RenderField.tsx     # interprets LayoutSpec
│   │   │   │   │   ├── ElementWrapper.tsx  # stamps element_id, click → bus
│   │   │   │   │   ├── primitives/
│   │   │   │   │   │   ├── MapView.tsx
│   │   │   │   │   │   ├── TimelineView.tsx
│   │   │   │   │   │   ├── AlertView.tsx
│   │   │   │   │   │   ├── NarrativeView.tsx
│   │   │   │   │   │   ├── TabularView.tsx
│   │   │   │   │   │   ├── LiveFeedView.tsx
│   │   │   │   │   │   └── McpAppFrame.tsx # SEP-1865 sandboxed iframe
│   │   │   │   │   └── compositions/
│   │   │   │   │       ├── MorningBrief.tsx
│   │   │   │   │       └── DroneFocus.tsx
│   │   │   │   └── audit/XRayDrawer.tsx
│   │   │   ├── lib/
│   │   │   │   ├── ipc.ts                  # tauri invoke + listen wrappers
│   │   │   │   ├── query-client.ts         # React Query w/ Tauri queryFn
│   │   │   │   ├── surface-bus.ts          # Zustand bus + bridge
│   │   │   │   ├── element-registry.ts     # id → metadata, ref resolution
│   │   │   │   ├── mcp-app-bridge.ts       # postMessage ↔ Rust JSON-RPC
│   │   │   │   ├── intent-router.ts        # rule-based follow-up router
│   │   │   │   ├── summary-templates.ts    # deterministic; LLM-swap interface
│   │   │   │   ├── composer.ts             # data + intent → LayoutSpec
│   │   │   │   └── types.ts
│   │   │   └── styles/
│   │   └── src-tauri/                      # Rust backend
│   │       ├── Cargo.toml
│   │       ├── tauri.conf.json
│   │       ├── build.rs
│   │       ├── icons/
│   │       └── src/
│   │           ├── main.rs
│   │           ├── lib.rs
│   │           ├── commands/               # invoked from React via tauri::command
│   │           │   ├── mod.rs
│   │           │   ├── mcp.rs              # list_tools, call_tool, fetch_ui_resource
│   │           │   ├── config.rs           # current_user_md, current_agent_md
│   │           │   ├── audit.rs            # query_log, replay
│   │           │   └── action.rs           # approve/reject → dispatch + log
│   │           ├── protocols/              # adapter registry; extensibility seam
│   │           │   ├── mod.rs              # ProtocolAdapter trait
│   │           │   ├── mcp/
│   │           │   │   ├── mod.rs
│   │           │   │   ├── client.rs       # JSON-RPC 2.0 over Streamable HTTP/SSE
│   │           │   │   ├── notifications.rs
│   │           │   │   └── apps.rs         # SEP-1865 ui:// fetch
│   │           │   └── README.md           # how [later] adapters slot in
│   │           ├── carrier/                # v0 = passthrough; later = ranking
│   │           │   ├── mod.rs              # CarrierRouter trait
│   │           │   └── passthrough.rs
│   │           ├── bus.rs                  # surface event bus (Rust ↔ frontend)
│   │           ├── config_watcher.rs       # `notify` crate
│   │           ├── config_parser.rs        # pragmatic section parser
│   │           ├── audit/
│   │           │   ├── mod.rs
│   │           │   ├── store.rs            # rusqlite, app data dir
│   │           │   └── replay.rs
│   │           └── sidecar/
│   │               └── mod.rs              # spawns/manages mock-mcp-server
│   │
│   └── mock-mcp-server/                    # Node sidecar (Tauri-managed)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts                    # @modelcontextprotocol/sdk server
│           ├── tools/
│           │   ├── get-fleet-status.ts
│           │   ├── get-anomalies.ts
│           │   ├── get-weather-window.ts
│           │   ├── get-customer-reports.ts
│           │   ├── get-drone-telemetry.ts
│           │   ├── get-baseline-comparison.ts
│           │   ├── recommend-action.ts
│           │   └── execute-action.ts
│           ├── ui-resources/               # SEP-1865 ui:// served here
│           │   ├── live-telemetry/
│           │   └── drone-focus/
│           ├── simulator/
│           │   ├── fleet-state.ts
│           │   ├── anomaly-injector.ts
│           │   └── scenario.ts
│           └── data/seed.json
│
├── packages/
│   └── protocol-types/                     # shared TS types
│
├── data/                                   # gitignored runtime state (mocks, fixtures)
│
└── scripts/
    ├── dev.sh
    └── inject-anomaly.sh
```

Audit DB lives in Tauri's platform-appropriate app data directory (`tauri::path::app_data_dir`), **not** in the project tree.

## 4. Process model

- **Rust main process** owns: JSON-RPC connection, sidecar lifecycle, file-watcher, audit log writes, surface bus.
- **Node sidecar** (`apps/mock-mcp-server`) runs `@modelcontextprotocol/sdk` over Streamable HTTP. Spawned and supervised by Rust via `tauri-plugin-shell`'s sidecar mechanism.
- **React frontend** invokes Tauri commands and listens to Tauri events. It never speaks to the mock server directly. It does instantiate sandboxed iframes for `ui://` resources and exchanges postMessage frames with them.

## 5. The surface event bus

A single concept, two implementations (Rust `bus.rs` + React `surface-bus.ts`), bridged through Tauri events. Built on day one.

### Element IDs

Composite, stable across recompositions when the same entity reappears:

```
<composition>/<primitive>/<source_tool>/<entity>
```

Example: `morning-brief/map/get_fleet_status/drone-7`. References stored in conversation history resolve by matching the `<source_tool>/<entity>` suffix when the full ID is no longer mounted.

### Events

Every event carries a **monotonic `seq`** field. Recompositions fire many remove/register events in quick succession; ordering them reliably matters for audit and debugging.

| Event | Fired when |
| --- | --- |
| `element.registered` | Primitive (or selectable sub-element) mounts |
| `element.updated` | Same identity, new data (e.g. drone 7 telemetry refreshes). Distinct from churn. |
| `element.removed` | Primitive unmounts |
| `element.selected` | User clicks/taps an element |
| `element.focused` | Hover or keyboard focus (lighter-weight signal) |
| `reference.inserted` | Conversation message contains `[ref:id]` token |
| `reference.resolved` | Reference chip clicked → highlight + scroll target into view |
| `recompose.requested` | Intent + optional anchor element |

### Reference fallback

Reference chips pointing at an element that is no longer mounted are **first-class**, not retrofit. Click resolves to:

> "This referred to *X* (Drone 7 anomaly, 9:14am Saturday), which isn't currently visible. Bring it back?"

with a one-click action that re-issues the originating composition request anchored on that entity. Element registry retains last-known metadata for unmounted IDs to make this possible.

## 6. Composition

- Composer is a pure function: `(intent, data, agent_md) → LayoutSpec`.
- Rules expressed declaratively per composition (`compositions/morning-brief.rules.ts`, `drone-focus.rules.ts`) shaped as `{ when, slots, primitives, bindings }`. A learned-selection layer can later replace selection logic without rewriting the engine.
- Mixed-mode is non-negotiable for v0: the Drone Focus composition combines structured-data primitives (timeline, baseline comparison) with at least one SEP-1865 `ui://` iframe (`McpAppFrame`). Both directions of MCP Apps are exercised honestly.

## 7. Other locked decisions

| | |
| --- | --- |
| Transport | Streamable HTTP between Rust ↔ mock server (server-push capable) |
| Conversation summary v0 | Deterministic templating; one-file swap to a real model later |
| Follow-up routing | Rule-based; out-of-grammar requests reply "not wired yet" and get logged as design-backlog events |
| Config files | Pragmatic section-based markdown parser; hot-reloaded via `notify` |
| Composition engine | Pure rule-based; rules declarative |
| Map | Leaflet + OpenStreetMap (no token) |
| Audit | rusqlite, single `events` table with `parent_id` for tracing, in app data dir, gitignored |
| Repo | pnpm workspaces (host + mock-mcp-server + protocol-types) |
| Frontend state | Zustand + TanStack Query with Tauri queryFn |
| MCP Apps usage | At least one `ui://` resource in morning brief surface, second in drone-focus composition |

## 8. Out of scope for v0

Carrier ranking and discovery, real auth, payments, multi-tenant onboarding, mobile, real-time hard-latency guarantees, real drone hardware, second operator domain (Legacy Cleanout), public-demo polish. These are **deferred, not forgotten** — the `protocols/` and `carrier/` seams exist precisely so they slot in later.

## 8a. Design north star: Chrome-grade ease of use

The carrier business depends on consumer-scale adoption of the surface, which depends on the surface feeling effortless to someone who has never heard of MCP. Operator workflows live as **progressive disclosure** on top of a default experience that reads as calm, immediate, and obvious — Chrome-grade legibility, not Bloomberg-grade density. Every feature decision asks: *would a first-time user with no operator context find this inviting?* If the answer is no, the feature lives behind a deliberate switch, not in the default path.

Practical implications carried through every increment:

- **Primitives stay domain-agnostic.** A timeline shows events, not "drone events." Domain shaping happens in composition rules, not in the primitive contracts.
- **Sensible defaults beat configuration.** A user with no `agent.md` should still see something useful on first open. `agent.md` ships with at least one consumer-shaped template alongside operator templates.
- **Zero-state is a first-class artifact**, not a "we'll fix it later." Empty state is inviting, not blank.
- **Visual restraint stays the default.** Information density is opt-in via composition, not the baseline.
- **Composition rules optimize the consumer single-shot case** ("ask once, see one composed answer") as the easy path; operator workflows are the harder case the same engine handles.

## 9. Build order

1. Tauri shell + bus + `MapView` rendering one mock tool call end-to-end. **(Current increment.)**
2. Remaining primitives (Timeline, Alert, Narrative, Tabular, LiveFeed, McpAppFrame) with mock data.
3. Real MCP wiring through Rust client (rmcp spike → custom or mixed).
4. Config substrate + hot reload.
5. Morning brief composition.
6. Anomaly scenario with mixed-mode `ui://drone-focus`.
7. Audit log + X-ray drawer + reference fallback UX.

Each step produces something runnable.
