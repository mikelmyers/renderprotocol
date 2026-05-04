# Render Surface — Strategic Update

**Companion to:** `render_surface_design_document.md` and `research_base_levels.md`
**Status:** Captures strategic conversation following base-level research. Updates the design document's strategic position. Sets up the first prototype build.
**Date:** May 2026

---

## How to read this document

This document captures the strategic thinking that happened after the base-level research surfaced major findings (especially MCP Apps shipping in January 2026, the crowded competitive landscape, and the more favorable acquisition environment than originally assumed).

The design document described *what to build*. The research document described *the factual landscape*. This document describes *the strategic position we have arrived at as a result of the conversation*, plus the specific decisions that shape what gets built first.

It is a working document. Sections may need revision after the first prototype produces real signal.

---

## 1. The strategic position, sharpened

### 1.1 What this is, in one sentence

An open agent network with a closed ranking algorithm running the best routing inside it, accessed through a free consumer-quality render surface.

### 1.2 The three layers, with revised emphasis

The original design document treated the surface as the primary product and the carrier as supporting infrastructure. Research and conversation revealed this was backward in terms of long-term value capture. The revised emphasis:

**Layer 1: Render surface (the demand wedge).** Free, consumer-quality. This is where humans go. Its job is adoption, not profit. Beautiful, fast, low-friction. No paid tier — the surface stays free at every level. The surface is the customer-acquisition mechanism for the carrier business underneath.

**Layer 2: Carrier (the moat and the money).** The discovery and routing layer for the agent network. Closed proprietary ranking algorithm. Open protocols around it (receipts, federation, query API, capability declarations). Long-term, this is where the largest revenue lives — through transaction take rates, attestation services, and premium placement.

**Layer 3: Protocols (used, not built).** MCP and MCP Apps for capability and rendering. ACP / MPP / x402 for commerce. TAP for identity. We are reference implementations of these standards, not authors of them.

### 1.3 The closed-algo / open-network architecture

This is the core architectural decision and it deserves to be stated clearly.

**Closed (proprietary):** The ranking algorithm itself, with all its weights, learned parameters, adversarial-resistance heuristics, intent classification logic, training data, and accumulated tuning. The aggregated reputation graph that the algorithm operates on. ML components that contribute to ranking.

**Open (published):** The receipt format and signing scheme. The capability declaration schema. The carrier-to-carrier federation protocol. The user-agent-to-carrier query API. The general principles of the algorithm (publishable as a paper). High-level explainability for individual rankings.

This architecture is precedented. Cloudflare runs the dominant DNS resolver on a fully open DNS protocol. Google ran the dominant search engine on fully open HTTP/HTML. The pattern is: open infrastructure, closed intelligence on top. It scales, it earns trust, and it makes lock-in suspicions weak because the open parts genuinely make data and reputation portable.

### 1.4 ~~The wedge: operator-grade for autonomous physical systems~~ *(deprecated)*

> **Deprecated.** The vertical-wedge framing was retired during the May-2026 pivot to "agent browser, period." `product_plan.md §1` and §6 reflect the current position: the carrier and the browser are domain-agnostic and there is no vertical wedge. The drone-ops vocabulary in this section is historical context. See also the `project_render_protocol_pivot` memory.

The first specific operator vertical is *autonomous physical systems operations* — drone fleets, eventually agricultural autonomy, security and surveillance, infrastructure inspection, search and rescue, maritime, ground autonomy.

The drone scenario clarified what the surface has to do uniquely well:

- Real-time multi-source composition (telemetry, video, radar, ADS-B, weather, hardware health)
- Anomaly detection composed onto the render field automatically
- Operator override and direct manipulation of agent actions
- Hard latency requirements (seconds, not minutes)
- Audit-trail-as-product-feature for safety, regulatory, and insurance reasons
- Hand-off between active pilots and meta-aware operators
- The render field composing situational awareness, not dashboards

This vertical is uniquely well-fit for Primordia: the lab generates the drone data, the data trains the models, the models compose the views, the views are operated through the render surface. End-to-end vertical integration that no current competitor has.

The relevant acquirer set for this vertical is different from the design document's original list: Anduril ($14B+), Shield AI ($5.3B), Palantir, Skydio (~$2.5B), Lockheed, Northrop, RTX, Boeing, possibly DoD direct. Real money for software that operates physical autonomous systems at scale.

### 1.5 The discipline: consumer-quality at every layer

A design constraint that shapes everything: the operator surface must be the same surface a consumer uses, with operator features as progressive disclosure rather than separate products.

The reason is structural. The carrier business only works if the render surface generates real call volume. Real call volume requires consumer-scale adoption. Consumer-scale adoption requires the surface to be free, beautiful, and frictionless for someone who has never heard of MCP. If we build only for operators, we never reach the scale that makes the carrier valuable.

This is the Linear / Notion / Figma pattern: easy entry, scale to power. Not the Bloomberg / Salesforce pattern. Bloomberg makes money from $24,000/seat operator subscriptions because it never had to be a consumer product. We can't do that — our long-term value is in network scale, which requires consumer adoption.

Implication for design: every feature decision has to work for someone with no operator context. If a feature only makes sense in operator workflows, it goes in advanced settings, not defaults. The operator surface is what we ship; the consumer surface is what falls out of disciplined defaults.

---

## 2. The economic model

### 2.1 The render surface is free, forever

No paywall on core functionality. No usage caps that matter for individual humans. No "free trial" that converts to paid. The render surface itself, with reasonable usage, is free for all consumers in perpetuity.

This is non-negotiable for the strategy to work. Every browser, search engine, social network, and messaging app in internet history has been free at the point of use. The value is downstream, not in the surface itself.

### 2.2 Where the money is

The render surface is free, full stop — no subscription, no paid tier, no premium features. All revenue is carrier-side. (An earlier draft of this doc proposed an operator-grade subscription tier; that has been removed per `product_plan.md §2.1`. Keeping the surface uniformly free simplifies the product, the onboarding, and the customer-support burden.)

**Carrier transaction take rate (largest long-term line).** When the carrier routes a call that involves payment via x402/ACP/MPP, the carrier takes a small percentage. Visa-style economics. At scale, this is the dominant revenue line. $1B routed at 1% take rate is $10M in carrier revenue. Real volume in 5+ years could be much larger.

**Carrier attestation services ($500-5000/server/year).** Verified placement, capability audits for high-stakes categories, ongoing compliance attestations. B2B revenue that scales with the number of servers in the network. At 10,000 verified servers, this is meaningful and high-margin.

**Carrier premium placement (10-20% of carrier revenue, no more).** Paid placements clearly labeled, limited in number, do not bypass ranking, lose their slots if performance is poor. Designed to not corrupt the ranking. Amazon-style sponsored listings, not Google-style ad mixing.

**Aggregated data products (carefully).** Network-level trends in capability demand, pricing, performance. Sold to enterprise customers, to servers (for benchmarking), to investors and policy makers. Privacy architecture must be airtight. Real product if done responsibly.

**Vertical operator solutions (high-touch enterprise).** For autonomous physical systems specifically: packaged solutions with pre-configured `agent.md` templates, vetted carrier specialists, integration support. Five-to-seven-figure annual contracts. Anduril / Shield AI / Palantir-shape customers.

### 2.3 The economic shape over time

**Years 1-2.** Free consumer surface (customer acquisition). Carrier revenue minimal (no volume yet). Cost center funded by Mikel, possibly seed capital. Probably losing money or breaking even.

**Years 3-4.** Consumer surface scaled. Carrier seeing meaningful transaction volume — take rate + attestations begin to cover ongoing operating costs. Consumer surface still subsidized.

**Years 5+.** If the carrier has won meaningful share, carrier transaction revenue dominates. Render surface remains free. Carrier infrastructure generates the profits. Visa / Mastercard / Cloudflare / Google structural profile.

---

## 3. Onboarding and cold start

### 3.1 The three audiences

**Operators (demand side).** First 50 operators get hand-built treatment — Mikel and Dani recruit them personally, set them up directly, help them author `user.md` and `agent.md`. Mikel is operator zero. Dani is operator one. Subsequent operators are recruited from the Mikel network: Lake Monticello-area service businesses, drone operators in Virginia, founders running multi-venture stacks, small business operators who would adopt by temperament. Direct relationships, not growth hacking.

**Server operators (supply side).** MCP servers integrate with the carrier by accepting routed calls, returning signed receipts, and optionally publishing capability declarations. Day-of-work integration for a competent dev. Incentives: discovery (real call volume), reputation portability (receipts work across carriers, no lock-in), specialty positioning (vertical specialist carriers).

**Other user agents (network effect amplifier).** Long-term goal: Claude, ChatGPT, custom agents, industrial agents all routing discovery through the carrier. Year 1 doesn't try this. Earned over years by becoming the highest-quality discovery layer for specific verticals first.

### 3.2 The cold-start mechanism for new servers

Naive "free traffic boost for new servers" gets gamed in thirty seconds. The actual mechanism layers several protections:

**Bounded exposure, not bounded ranking.** New servers get exposure to 1-3% of matching queries during a learning period. Exposure is data-gathering, not ranking advantage. User agents are informed when routing is exploratory; users can opt out for high-stakes operations. Spammers can't use the boost to get better placement; they can only use it to get evaluated faster, and evaluation tanks them.

**Stake required.** New servers post a bond ($500, calibrated by category) for exploratory exposure. Bond is forfeit on detected fraud, abuse, or capability misrepresentation. Honest servers get bonds back. 100 fake servers means $50,000 at risk — this scales spam costs in a useful way.

**Vouching from existing trusted entities.** Established servers can vouch for new ones, raising their starting trust score. Vouchers stake their own reputation; bad new servers cost their voucher's reputation too. Web of trust gates new entry through social structure as well as money.

**Category-specific rules.** High-stakes categories (irreversible financial transactions) require longer exploration periods, larger bonds, more vouching. Low-stakes categories (read-only data, casual recommendations) can have lighter requirements. Stops the obvious "spam the high-value category" attack.

**Adversarial monitoring during exploration.** Algorithm specifically watches for cold-start gaming patterns: cliques of new servers calling each other, sudden bursts of perfect-success-rate calls, suspiciously consistent latency profiles. Trips during exploration cut off exposure and forfeit bond before reputation accrues.

### 3.3 The sequence

**Phase 1, months 1-6.** Build surface and carrier together for Primordia. Mikel is operator zero, Dani is operator one. Carrier has one user (the surface) and a handful of server integrations (MCP servers Primordia drone operations touches). Learn what the algorithm needs from real use.

**Phase 2, months 6-12.** Add 5-10 hand-recruited operators. Different verticals deliberately — drone operations, estate services, small business operations, possibly a research lab. Diversity stress-tests both surface and algorithm. Server integrations grow as those operators need them. Reputation graph starts having structure.

**Phase 3, months 12-24.** First public beta. Self-serve onboarding for operators. Carrier hardened by a year of internal use. Server integrations grow organically. Begin conversations with one or two other user-agent makers about routing through the carrier.

**Phase 4, months 24+.** Carrier is real infrastructure with real call volume. Third-party user agent integration becomes a real conversation, decided by data not speculation. Either it happens (carrier wins as routing layer for X verticals) or it doesn't (you've still built a great vertical operator product). Both fine.

---

## 4. The algorithm sketch

### 4.1 RouteRank (working name)

Six components, layered:

**Component 1: Capability matching.** Hard-constraint filtering (region, price ceiling, latency, required parameters). Embedding-based semantic match for soft constraints. Fast and cheap; eliminates most candidates before scoring.

**Component 2: Performance score.** Multi-dimensional vector for each candidate: reliability, latency, accuracy, cost-stability, freshness. Bayesian-smoothed estimates (priors handle cold-start). Recency-weighted with dimension-specific decay constants. Stored as vectors so re-weighting at query time is cheap.

**Component 3: Authority score.** PageRank analogue on the call graph. Edges weighted by outcome (successful, well-rated calls = strong positive; failed or reversed calls = negative). Multi-dimensional authority — different authority types for different intent categories. Computed iteratively, updated incrementally.

**Component 4: Adversarial-resistance score.** Reputation velocity caps (real reputation accretes; fake is bursty). Sybil cluster detection (high clustering coefficient, low diversity = penalty). Receipt anomaly detection (self-reports diverging from receipts). Stake-at-risk bonus (skin in the game). Cross-carrier consistency checks.

**Component 5: Final ranking.** Multiplicative combination of components. Bad scores in any dimension torpedo the ranking (weakest-link binding). Exploration noise injection so new candidates keep getting evaluated.

**Component 6: Online learning.** Weights are themselves learned. Slow-learning gradient descent over receipt outcomes. Different categories develop different learned weight profiles over time.

### 4.2 The data substrate

Capability declarations (signed, structured, published). Call receipts (signed by both parties, includes outcome). Outcome signals (delayed feedback, ratings, reversals). Trust attestations (carrier-to-entity attestations). Stake declarations (bonds against claims).

Continuously-updating graph with cryptographic provenance. Algorithm runs on top.

### 4.3 The hard problems flagged for later

- The cold-start problem for new servers (mechanism sketched above; needs real data to tune)
- The cold-start problem for the carrier itself (chicken-and-egg with the surface; bootstrap from Primordia traffic)
- The privacy model (receipts contain sensitive data; aggregation with cryptographic proofs of honesty needed)
- The decentralization question (open protocol with federation between carriers; your carrier is largest but not only)

---

## 5. The MCP Apps reframe

The base research surfaced that MCP Apps (SEP-1865) shipped on January 26, 2026, co-developed by Anthropic and OpenAI. This standardizes the basic mechanism of "agent returns structured UI, host renders it in conversation."

This is good news, not bad news. It means:

- The first build is cheaper. We don't invent the rendering protocol; we build on it.
- Compatibility is built in. Servers built for Claude or ChatGPT will work in our surface and vice versa.
- Differentiation is at the host level, not the protocol level. Multi-source composition, audit, configuration substrate, and the carrier layer are where we win.

The render surface is, structurally, an MCP Apps host with multi-source composition and a default carrier built in. That is the design starting point for the prototype.

---

## 6. The first prototype

### 6.1 Goals

The first prototype's job is to make this concrete enough that we can see what we're building, learn what the design grammar wants to be, and produce the first signal about whether the operator surface for Primordia drone operations is a real product. Not a complete product. Not a launch. A working artifact we can use, react to, and iterate from.

Specifically, the prototype should demonstrate:

- A two-pane interface with conversation panel and render field
- The render field composing views from structured data (not browsing pages)
- An `agent.md` and `user.md` configuration substrate
- Loading and rendering MCP Apps from one or more MCP servers
- A morning brief composition pattern for Primordia operations
- The drone scenario at minimum-viable fidelity: anomaly detection composed onto the render field, operator can review and approve action

### 6.2 Explicit non-goals for the first prototype

The carrier layer is not in the first prototype. The algorithm is not in the first prototype. The cold-start mechanism is not in the first prototype. Multi-tenant onboarding, payment integration, real drone hardware integration, mobile, real-time hard-latency guarantees — none of these are in the first prototype.

The first prototype is about *seeing the surface*. Everything else follows from confirming the surface shape is right.

### 6.3 The build approach

Use Claude Code. Single-developer prototype. Local-first, web-based UI. Mock data simulating Primordia drone operations sufficient for the morning brief and the drone anomaly scenario. Real MCP Apps integration so the rendering pattern is exercised honestly. Real `agent.md` and `user.md` files in the repo as starting templates.

The next document in this sequence is the Claude Code prompt that initiates the build.

---

*End of strategic update. Version 0.1, May 2026.*
