# Product Plan — Browser + Carrier

**Companion to:** `strategic_update.md` (the strategic position) and `route_rank_plan.md` (the substrate build).
**Date:** May 2026.
**Status:** Working planning document. Revise as the products mature against real users.

---

## 0. What this document is

The previous planning artifacts (`strategic_update.md`, `route_rank_plan.md`) covered (a) what the strategic position is and (b) how to build the algorithmic substrate. This document covers what we're actually shipping as products, who uses them, how they make money, and how we sequence both products in parallel so the flywheel ignites.

This is a working document. It says what we believe today. It will be revised as real users teach us what's actually true.

---

## 1. The two products

We are building two parallel products that depend on each other to be useful. Neither stands alone. Both have to ship to viability roughly together, or the whole construction fails.

### 1.1 The browser (render surface)

A free desktop client, downloadable from a marketing site, available on Mac / Windows / Linux. The browser is the agent-internet's analogue to Chrome: it hosts a per-user LLM agent that interprets intent, calls capabilities through the carrier network, and renders composed results in a structured surface.

The browser's purpose is **adoption**. It is free forever, polished, frictionless to install. It does not monetize directly — there is no paid tier, no subscription, no premium features gated behind a paywall. Its job is to be the surface millions of people use to interact with the agent internet, which generates the call volume that monetizes the carrier underneath.

The user-visible value proposition: *"Ask anything. Your agent decomposes intent, the network's best providers respond, results compose into one coherent view. No tab-switching. No copy-paste. No tool fatigue."*

Concrete capabilities the browser provides:
- Per-user LLM agent in the conversation panel, steered by user-authored `agent.md` / `user.md` files.
- Multi-step tool calling — one user prompt routes to N tool calls across multiple hosting agents.
- Composed render field — primitives (narrative, tabular, alert, timeline, MCP App iframe) compose into a unified view per response.
- Streaming results — partial primitives mount as data arrives.
- Conversation memory across sessions.
- Settings, history, multi-context (multiple conversations side-by-side eventually).
- Default carrier is *our* carrier; user cannot trivially swap. Same pattern as Chrome shipping with Google as default.

### 1.2 The carrier (search algo network)

A network with a closed proprietary ranking algorithm (RouteRank) sitting on top of open protocols (MCP for capabilities, ACP / SPT for commerce, Ed25519-signed receipts for portable provenance, eventual federation API for peer-carrier interop). The carrier accepts capability declarations from hosting agents, ranks them per query, routes browser-side calls to the best provider, settles take-rate splits when calls involve payment, and emits signed receipts that build accumulated reputation.

The carrier's purpose is **monetization and moat**. It is the durable revenue line and the irreplaceable artifact. The algorithm's accumulated reputation graph is what an acquirer ultimately buys; the browser is the customer-acquisition mechanism for the carrier business.

Concrete capabilities the carrier provides:
- Discovery — hosting agents self-register; the carrier finds them.
- Ranking — RouteRank weighs reliability, latency, authority, vouching, adversarial resistance into a single score per (agent, tool, query).
- Routing — picks the best provider per call with built-in exploration noise.
- Signed receipts — every call is cryptographically attested, portable across carriers (per the open spec).
- Payments substrate — capability declarations include pricing; real Stripe Connect destination charges settle take-rate splits.
- Lifecycle management — cold-start exploration with bonded exposure, four-gate Production promotion, two-tier suspension on adversarial signals, manual + eventual auto Forfeit.
- Vouching — Production-eligible agents endorse others, with mutual punishment when vouchees misbehave.

### 1.3 Why both products in parallel

The product is the system. Either piece without the other is useless:

- A carrier with no browser has no demand-side users. Hosting agents won't register because there's no traffic. Without traffic the algorithm is ranking nothing.
- A browser with no carrier is a tool launcher. It's the same thing Anthropic's Claude desktop already is. No moat.

The two products co-bootstrap. We hand-build both sides until critical mass, then network effects do the work. The build sequence in §3 is the explicit choreography of how those two sides come up together.

---

## 2. The business

### 2.1 Browser business model

**Free forever. No paid tier. No subscription.** Every browser, search engine, social network, and messaging app in internet history has been free at the point of use for individual consumers. That's not a coincidence — it's the only model that scales to network adoption. We charge transactionally (carrier take rate) and we charge hosting agents (attestation services); we do not charge individuals or teams to use the browser, period.

The browser has no revenue lines of its own. It exists to drive call volume into the carrier. All monetization is carrier-side. Keep the browser simple — fewer levers, fewer ways to corrupt the experience, less surface area for the user to be confused or annoyed.

### 2.2 Carrier business model

This is the actual business.

- **Transaction take rate** — when the carrier routes a call that involves payment via x402 / ACP / MPP / Stripe Connect, the carrier takes a small percentage (default 1.00%, per-agent overridable). Visa-style economics. At scale this is the dominant revenue line: $1B routed at 1% = $10M.
- **Attestation services** — $500-5000/server/year for "verified placement" + capability audits + ongoing compliance attestations. B2B revenue scaling with the count of verified servers. At 10,000 verified servers, meaningful and high-margin.
- **Premium placement** — 10-20% of carrier revenue, no more. Paid placements clearly labeled, bounded in number, do not bypass ranking, lose slots if performance is poor. Designed to not corrupt the ranking. Amazon-style sponsored listings, not Google-style ad mixing.
- **Aggregated data products (carefully)** — network-level trends in capability demand, pricing, performance. Sold to enterprise customers, to servers (for benchmarking), to investors and policy makers. Privacy architecture must be airtight. Real product if done responsibly.

### 2.3 The flywheel

```
        +----------------------+
        |   Browser users      |
        |   (free download)    |
        +-----------+----------+
                    |
                    v
        +----------------------+
        |   Carrier call       |
        |   volume             |
        +-----------+----------+
                    |
                    v
        +----------------------+         +-----------------+
        |   Hosting agents     |<--------|   Take rate +   |
        |   register / get     |         |   attestation   |
        |   traffic + revenue  |-------->|   revenue       |
        +-----------+----------+         +-----------------+
                    |
                    v
        +----------------------+
        |   Browser experience |
        |   improves           |
        |   (more capabilities)|
        +-----------+----------+
                    |
                    v
              (more users)
```

The lock-in: browser users come for the experience; the experience improves with hosting-agent variety; hosting agents stay because our ranking gives them the best traffic match they can find anywhere. Algorithm quality is what holds both sides.

### 2.4 What "having users" means

For the browser, "users" means individuals who downloaded the client and use it weekly. The first 1,000 are hand-built; the next 10,000 come from word-of-mouth in the AI-curious prosumer demographic; the next 100,000 come from organic spread as call volume routes more interesting capabilities to a more useful surface; mass-consumer scale is years away.

For the carrier, "users" means *hosting agents* — MCP servers registered with our carrier and accepting routed traffic. The first 20 are hand-recruited from the existing MCP ecosystem; the next 200 come from self-registration as the user base grows; further scale comes from the verified-attestation tier providing reasons to register.

Both sides have to grow in roughly proportional cadence. If browser users outpace hosting agents, the experience thins out. If hosting agents outpace browser users, supply abandons us before traction lands. We pace both consciously.

---

## 3. Path to viability

### 3.1 Browser path to v1

Where the browser is today: a Tauri shell with two-pane composition, MCP Apps SEP-1865 host, primitive vocabulary, conversation panel routed by a regex placeholder. The substrate works. The user-facing agent is the missing centerpiece.

What v1 needs:
1. **LLM user agent in the conversation panel.** Replace `intent-router.ts` with an actual model (Anthropic SDK, user-supplied API key in v0). The agent reads `agent.md` / `user.md`, decomposes intent, calls MCP tools through the carrier, multi-steps as needed, composes results into the render field.
2. **Multi-step tool composition.** One user prompt → N tool calls across multiple agents → unified render-field view. The user agent orchestrates; the carrier routes each step.
3. **Streaming responses.** Render field updates incrementally as data arrives. Anthropic SDK already supports content-block streaming.
4. **Conversation memory.** Persisted to SQLite alongside receipts. User agent reads recent history into its context on each turn.
5. **Onboarding.** First-run experience: starter `agent.md` template, walk-through of the conversation panel, sample queries that demonstrate the carrier's value.
6. **Settings.** API key entry, theme, default `user.md` location, conversation export.
7. **Cross-platform installer + auto-update.** Tauri release pipeline with signed Windows / Mac / Linux artifacts. GitHub Actions on tag push.

### 3.2 Carrier path to v1

Where the carrier is today: full RouteRank substrate (5a / 5b / 5c shipped on `main`, 65 unit tests + 4 live verifications passing). ε-greedy exploration prevents lockout; lifecycle persistence ensures Forfeit survives restart. Two mock hosting agents in the demo.

What v1 needs:
1. **Self-registration page.** Web form on the marketing site that takes endpoint URL + capability declaration, validates connectivity, writes to a public registry the carrier reads on boot. Operator's effort: 10 minutes.
2. **First 20 hand-recruited hosting agents.** Reach out individually to existing MCP server operators (mcp.so, modelcontextprotocol GitHub contributors, public Linear / Stripe / GitHub MCPs). Pitch: free traffic + signed receipts + portable reputation. Each one onboarded by Mike personally.
3. **Real Stripe Connect destination charges.** One real $0.01 transaction routes through, settles a take-rate split, demonstrates the payment flow. Replaces the stub backend in production paths while keeping it as the test default.
4. **Capability declaration v2.** Hosting agents declare richer metadata: pricing, identity attestation, vouching, region affinity, intent-category tags. The carrier needs more dimensions to rank against once supply scales beyond a handful.
5. **Receipt portability spec, published.** v0 receipt JSON Schema as a public standard. CLI tool that verifies a receipt outside our carrier. The "open infrastructure" claim becomes credible.
6. **Verified-attestation tier.** B2B billing mechanism for hosting agents that want a "verified" badge. Manual review process initially; automation comes later.
7. **Telemetry + observability.** Timeseries for call volume, latency distributions, ranking score histograms, lifecycle transitions. We need to know when something is wrong before users notice.
8. **Online learning over weights.** Activates once outcome signals (user satisfaction events from the browser-side agent) flow into the carrier. The moat self-tunes.

### 3.3 Joint dependencies

The two paths interleave at three points:

- **The user agent (browser §3.1.1) generates outcome signals (carrier §3.2.8).** Without the LLM agent in the browser, the carrier has no learning data. Browser §3.1.1 is the unblock for carrier §3.2.8.
- **The capability declaration v2 (carrier §3.2.4) is consumed by the user agent (browser §3.1.1).** The user agent reads pricing, intent categories, etc. from each tool's declaration to make better decomposition decisions. Carrier §3.2.4 enriches the browser's behavior.
- **Marketing site hosts both** — browser downloads and hosting-agent registrations live on the same site. Single piece of real estate, two CTAs.

---

## 4. Milestones

### 4.1 30 days

- Browser: LLM user agent live in the conversation panel (single-step is enough; multi-step can wait). Replace the regex router.
- Carrier: marketing site live with download links + a self-registration form (even if manual approval initially).
- Joint: first non-Mike installs of the browser. First non-mock hosting agent registered. Aim for 5 of each.

### 4.2 90 days

- Browser: multi-step composition + streaming + ranking-debug drawer + onboarding flow. Polished v1 release.
- Carrier: 20 hosting agents live, real Stripe Connect take-rate routing on at least one paid call, capability declaration v2 spec published, receipt portability spec published.
- Joint: 100-1000 active browser users. Public launch.

### 4.3 6 months

- Browser: mobile/web client in alpha. Conversation memory. Settings polish. Multi-context support.
- Carrier: 50-100 hosting agents, vouching live with multiple eligible vouchers, attestation tier billing active, real online-learning gradient over weights.
- Joint: thousands of active users. First meaningful transaction volume on the take rate. Predictable revenue from attestations.

### 4.4 12 months

- Browser: all platforms, polished, retention curves stabilizing.
- Carrier: 200-500 hosting agents, federation protocol in test with one peer carrier, online learning showing measurable improvement.
- Business: clear unit economics. Take rate generating five-figure monthly revenue. Attestations covering ongoing operating costs. CAC / LTV understood per acquisition channel.

### 4.5 What "acquisition-ready" looks like

Not a milestone we control directly. The signal is: an inbound conversation where an acquirer's strategic team contacts us, not the other way around. The conditions that produce that conversation are the milestones above. Specifically: monthly browser users in the low-five-figure range, hundreds of hosting agents, predictable revenue, demonstrably better routing than the acquirer could build internally in two quarters. Probably the 12-month-out window. Could be earlier if a strategic acquirer's roadmap forces their hand. Could be later if traction takes longer; that's fine, we're building a real business.

---

## 5. Risks

### 5.1 Technical

- **Federation is unbuilt and may be harder than the substrate suggests.** Cross-carrier consistency, identity attestation chains, key infrastructure — all real work, all unstarted. Federation is the open-network claim; without it our positioning weakens.
- **Adversarial pressure has never hit the system.** The mechanisms are research-validated but not battle-tested. First serious attack will reveal gaps.
- **Performance under load is uncharacterized.** SQLite + parking_lot + sync writes work for v0 demo traffic. They may not work for thousands of calls per second.
- **Online learning is non-trivial.** Calibrating gradients against delayed outcome signals is a research problem in itself. The slot is reserved; making it actually work is months.

### 5.2 Adoption

- **Chicken-and-egg between browser users and hosting agents.** We solve this by hand-building both sides initially. But the cadence has to be right. If we lose patience and over-rotate to one side, the flywheel doesn't ignite.
- **The "10x better" pitch has to be sharpened.** ChatGPT can already call MCP tools. Why does anyone download a separate browser? The answer is composition + transparency + portable reputation + user-controlled context — but that has to be *experienced*, not asserted. Onboarding has to demonstrate it within the first two minutes.
- **Distribution path for the desktop client is hard.** Even with a polished marketing site, asking individuals to download a desktop app is friction. The wedge community has to be one that's willing to do that — AI early adopters, prosumers, agency operators. Mass consumer reach probably waits for a web/mobile client.

### 5.3 Competitive

- **OpenAI / Anthropic could absorb the use case.** ChatGPT already does MCP tool calls; either could add a discovery + ranking layer in a few quarters. Our defensibility is (a) algorithm quality, (b) accumulated reputation graph, (c) hosting-agent switching costs as their history with us deepens. The window where acquisition-or-build favors acquisition is real but narrow.
- **OS-level AI (Apple Intelligence, Windows Copilot) could flatten the entire browser layer.** If the OS becomes the user's primary AI surface, "agent browser" is a niche. We hedge by being protocol-compatible: even if the OS surface absorbs the demand-side, our carrier can route from any compliant client.
- **A well-funded competitor (Perplexity, Cursor, Arc) could pivot into this space.** Less likely than the OpenAI/Anthropic risk but worth tracking.

### 5.4 Regulatory

- **Closed ranking + payment routing + AI agent intermediating user actions** is a stack that attracts regulator attention. EU's DSA, antitrust scrutiny, AI Act, payment regulations.
- **Liability for agent actions.** A user's agent (in our browser) calls a hosting agent (through our carrier) that takes an action with real-world consequences. Whose liability? Lawyers before scale, not after.
- **Privacy.** Receipts hold what users asked + what they got. We hold them. GDPR / CCPA require executable "delete my data" answers. End-to-end privacy architecture is a v0.5 concern, not a v2 concern.

---

## 6. What's not in this plan

- **Hiring.** A real product needs engineers, designers, growth, payments, T&S. That's a separate plan keyed to fundraising.
- **Fundraising.** We will need capital to support the build above. Not addressed here. Probably seed → A around the 12-month milestone.
- **Specific verticals.** The carrier is domain-agnostic; the browser is domain-agnostic. There is no vertical wedge. The product is the algorithm and the surface, not a packaged solution for a specific industry. Earlier versions of the planning artifacts proposed drone ops as a vertical wedge; that has been deprecated and is not part of this plan.
- **International expansion.** Out of scope until the first market (US/EN) is working.
- **Government / DoD / regulated industries.** Out of scope until adversarial resistance has been pressure-tested in commercial contexts first.

---

## 7. What needs to happen next

In order. Each item is a workstream, not a single PR.

1. **LLM user agent in the browser.** Anthropic SDK in the conversation panel, replacing the regex intent router. The single most important next step. Without it, the browser is incomplete. ~2-3 weeks.
2. **Marketing site + hosting-agent self-registration.** Even a static landing page with a download link and a registration form. Distribution and supply onboarding don't start without this. ~2 weeks (mostly UX work, not engineering).
3. **First 20 hand-recruited hosting agents.** Personal outreach to existing MCP server operators. Mike's job; the carrier already accepts their registration if they fill the form. ~ongoing, not a discrete sprint.
4. **Multi-step composition + streaming + ranking-debug drawer.** Layer onto the user agent in the conversation panel. Makes the demo non-trivial and the moat visible. ~3-4 weeks.
5. **Real Stripe Connect destination charge live.** One paid call routes end-to-end. Removes the "this is just stubs" caveat from the payments story. ~2 weeks.
6. **Capability declaration v2 + receipt portability spec.** Both as published specs, enforced by code. Open-protocol credibility. ~2-3 weeks.
7. **Telemetry + observability.** We can't run a real product without knowing what's happening. ~1-2 weeks.

Total to a credible v1 of both products in production: roughly **3-4 months of focused work** assuming current scope holds and no major team expansion. That's the "first real users on a real product" timeline.

---

*End of plan. Version 0.1, May 2026. Revise after the first 100 real browser users + first 20 real hosting agents land.*
