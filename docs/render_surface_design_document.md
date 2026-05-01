# The Render Surface

**A founder's working design document**

*Working title only. Project naming deferred until the shape is firm.*

*Authors: Mikel Myers, Primordia Systems LLC. Synthesized in conversation, May 2026.*
*Status: First draft. Captures thinking, names trade-offs, surfaces open questions, defines research agenda.*

---

## 0. How to read this document

This is a working document, not a pitch deck and not a technical specification. It captures the full thesis we have arrived at, the design decisions we have made, the design decisions we have explicitly deferred, the strategic position we are taking, and the research that has to happen before any of this becomes implementation work.

It is written for Mikel and any technical advisor or close collaborator brought into the thinking — not for investors, not for press, not for users. The tone is internal: it names uncertainty, flags where reasoning is thin, and keeps the strategic frame visible alongside the design frame.

The document is meant to be edited. Sections marked with `[OPEN QUESTION]` or `[RESEARCH NEEDED]` are not blockers to writing — they are the agenda for what comes next.

---

## 1. The thesis

### 1.1 The shift this is responding to

For roughly fifty years, every interface a human has used to operate a computer has been a *container* — an application, a website, a dashboard, a kiosk, an infotainment screen — pre-built by someone in advance and offered to the user as a take-it-or-leave-it shape. The user's job has been to learn the container and adapt to it.

Containers exist because, until recently, generating an interface on demand was impossible. Software could not understand a user's intent well enough to compose anything useful in response. So instead, software shipped containers — generic, learnable, defensible-by-consistency — and made humans bend.

That constraint is dissolving. With agents capable of understanding intent, querying capabilities, and assembling structured responses, the unit of software stops being the container and starts being the *intent*. Interfaces compose around the moment instead of being built in advance. This is a phase change in computing — comparable in scale to GUI replacing command-line, or mobile replacing desktop, and possibly larger because both of those were still containers at heart.

This document describes a product designed for that shift.

### 1.2 The core thesis in one paragraph

A new interface category is forming where humans no longer browse the web. Instead, they express intent to their own agent, which talks to other agents — discovery agents, marketplace agents, capability-providing service agents — through an open agent-to-agent protocol, and composes a purpose-built view in response. The "browser" of this era is not a renderer for documents authored elsewhere; it is a *render surface* where the user's agent assembles structured data from across the agent network into views designed for the specific question being asked. The web becomes infrastructure that agents query. Humans see only the composed answer.

### 1.3 What is and is not changing

The model is changing — fewer pre-built containers, more composed views. The protocol layer is changing — fewer HTML documents, more capability calls. The discovery layer is changing — fewer ranked links, more agent-mediated routing through specialized carriers. The economic layer is changing — vendors lose layout authority and retain capability authority.

What is not changing: humans still want visual richness, fast feedback, trust signals, and intuition. They still need to see pictures, comparisons, maps, video, real-time state. The render surface is not a terminal and not a chatbot. It is an interface designed to deliver visual, intuitive, fast experiences through composition rather than through pre-built pages.

### 1.4 Why this is winnable now

Three conditions are aligning that did not exist twelve months ago.

The protocol layer is being built by people with vastly more resources than any startup. Anthropic shipped the Model Context Protocol (MCP) in late 2024 and has driven adoption across the industry. Stripe shipped the Agentic Commerce Protocol (ACP), Machine Payments Protocol (MPP), x402 stablecoin rails, and the Link Agent Wallet at Sessions 2026. Visa is implementing the Trusted Agent Protocol for cryptographic agent identity. The substrate exists. Building on top of it, rather than competing with it, is now a viable strategy.

The incumbents are trapped by their existing businesses. Google cannot ship a true post-search agent surface without cannibalizing search advertising. Apple cannot ship a cross-platform agent surface without weakening the iPhone moat. Microsoft has Copilot but is constrained by Office and Windows shapes. OpenAI is closer than any of them but is growing a chat product into an agent product, which is a different starting shape than building the surface from first principles.

Agents themselves are honest users in a way humans are not. Agents do not have brand loyalty, do not tolerate friction, and switch instantly when something better appears. This means user acquisition for agent-targeted infrastructure is fundamentally different from consumer software — convince a few thousand agent developers and operator companies that your surface is the cleanest place for their agents to render output, and the agents themselves drive adoption.

The window is real. It is also not infinite. Best estimate: 18-30 months before the trapped incumbents become un-trapped or before another startup ships the right shape.

---

## 2. The design

### 2.1 The shape of the surface

The render surface has two primary regions and a set of supporting structures.

**Conversation panel.** A persistent region where the user's agent lives. This is where intent originates, where the agent communicates back, where the audit trail is referenced, and where memory is anchored. The conversation panel is stable across sessions — it is the user's relationship with their agent, not a tab.

**Render field.** The much larger region where the agent composes views. This region is empty by default (or pre-populated according to user configuration) and fills with whatever the user's agent has assembled in response to intent or to standing watches. The render field does not display web pages. It displays composed views built from structured data returned by other agents.

**Configuration substrate.** Two human-readable files that govern behavior.

- `user.md` — the user's self-description. Preferences, taste, working style, what to surface, what to suppress, who to trust, domains of interest. Written in the user's voice. Updated over time, with permission, by the agent.
- `agent.md` — the agent's operating contract. Purpose, scope, default behaviors, permissions, ethics, approval rules, carrier preferences. Per-context (different agents for different operations).

A third file, tentatively `world.md` or `context.md`, holds operator-specific domain knowledge: fleet rosters, customer lists, regulatory regimes, known patterns. This is what the agent treats as ground truth about the operating environment. `[OPEN QUESTION: should world knowledge be a third file or merged into agent.md? Trade-off is between separation of concerns and configuration sprawl.]`

**Audit and replay layer.** Every composed view in the render field has a derivable provenance: which agents were called, what they returned, how the user's agent composed the result. The default view is the answer; the audit layer is interrogable on demand ("x-ray mode"). For operator use cases, this is non-negotiable.

### 2.2 The architecture in three layers

The user-facing surface (this product) sits on top of a three-layer agent architecture.

**Layer 1: User agent (the surface owns this).** The agent that knows the user, holds context, applies `user.md` and `agent.md`, makes composition decisions, manages permissions and approvals, retains memory, runs the audit log. Every user has at least one user agent; operators may have several scoped to different contexts (Primordia operations, Legacy Cleanout operations, personal life).

**Layer 2: Carrier agents (the surface ships defaults; ecosystem extends).** Middleware between user agents and server agents. Carriers handle discovery, aggregation, ranking, trust attestation, privacy intermediation, and vertical specialization. The surface ships a default general-purpose carrier. Specialist carriers — vertical (real estate, logistics, finance), trust-based (reputation aggregators), or privacy-first (identity shields) — plug in via the protocol. Users and their agents can install, swap, trust-rank, and remove carriers.

**Layer 3: Server agents (the surface does not own; uses MCP).** The actual capability providers — drone fleet APIs, CRM systems, inventory databases, weather services, regulatory filings, customer communication systems. These are exposed via MCP (Model Context Protocol) and other capability-exposure standards. The surface does not build server agents. It is MCP-native and integrates with whatever ecosystem MCP is growing.

The transport between these layers is MCP plus emerging agent-to-agent protocols (ACP, MPP, x402 for payment). The surface contributes to and uses these standards rather than reinventing them.

### 2.3 The composition primitives

The render field assembles views from a vocabulary of composable primitives. The agent does not pick from "dashboard layout #4." It assembles from this grammar:

- **Map views** — geographic positions, routes, fleet locations, job sites
- **Timeline views** — sequence of events, mission progress, communication history
- **Live feeds** — camera, telemetry stream, real-time data
- **Tabular views** — structured records, comparisons, lists
- **Comparison views** — side-by-side analysis, diff renderings
- **Alert views** — items needing attention, prioritized
- **Narrative views** — agent-authored summaries with embedded citations to source data
- **Annotation views** — user-added marks, pins, notes
- **Form views** — structured input requested by an agent (approval, refinement, choice)

`[OPEN QUESTION: is this list exhaustive? It is almost certainly incomplete. The right primitives will emerge from designing real moments in real domains. The list above is the starting vocabulary, not the final one.]`

Composition rules govern how primitives are arranged for a given intent and context. These rules are partly authored (the design grammar of the surface) and partly learned (which compositions work for which kinds of questions, derived from usage data over time).

### 2.4 Affordances on the render field

The render field is interactive in specific ways:

**Pointing.** The user can reference any element in the render field from the conversation panel ("that drone in the upper-left, show me its history"). The link between conversation and render field is bidirectional — references resolve, follow-ups produce recomposed views.

**Drilling.** Tapping or selecting an element produces a deeper view of that element. The drill operation may be a recomposition (a new view focused on the element) or an expansion (more detail in place).

**Pinning.** The user can mark elements or compositions as standing concerns. Pinned items appear by default in future morning briefs and ambient views.

**Refining.** The user can adjust the composition through natural language ("smaller," "show this as a map instead," "filter to last 24 hours"). Direct manipulation (drag to resize, drag to rearrange) is also supported but secondary.

**Interrogating.** Any element can be queried for provenance. "Where did this number come from? Which agent provided it? When?"

**Persisting.** Compositions can be saved as named views. The user agent learns these as templates and can re-compose similar views on similar intents.

`[OPEN QUESTION: how much direct-manipulation versus how much language-based control? Designing both is expensive. The right ratio likely depends on the user's expertise and context. Operators in dense workflows probably want manipulation; casual users probably want language. Default may need to be context-aware.]`

### 2.5 The configuration substrate in detail

`user.md` example (sketch only):

```markdown
# User Profile: Mikel Myers

## How I work
I run multiple ventures concurrently. Mornings start with operational status,
not news. I want signal, not summaries of summaries. Show me anomalies before
all-clears.

## Domains
- Primordia Systems (cognitive architecture, drone fleet ops)
- Legacy Cleanout (estate transition services)
- Apex deployment at Malloy Ford

## Preferences
- Visual: maps and timelines over tables when possible
- Tone: direct. Skip "great question" language.
- Trust: my partner Dani has equal authority on Legacy Cleanout matters.

## Standing concerns
- Drone hardware health
- Legacy Cleanout job pipeline
- Anything from Anthropic, OpenAI, or Stripe touching agent infrastructure
```

`agent.md` example (sketch only, for the Primordia operations context):

```markdown
# Primordia Operations Agent

## Purpose
Operate as Mikel's primary interface for Primordia drone fleet operations,
mission management, and customer reports.

## Defaults
- Open with overnight summary plus any active anomalies
- Compose morning brief: fleet status, anomalies, weather window, customer reports
- Surface anomalies before all-clears

## Permissions
- Read: all telemetry, mission logs, customer communications
- Write (auto): annotations, pins, internal notes
- Write (approval required): customer-facing communication, regulatory filings
- Spend (auto): up to $50/day on capability calls
- Spend (approval required): anything above $50

## Carriers
- Default discovery: [carrier-id]
- Specialist: [logistics-carrier-id] for hardware procurement
- Avoid: [carrier-id] until trust score restored

## Audit
- Retain full audit logs 90 days
- Surface audit on any external action automatically
```

`[OPEN QUESTION: should these files live locally with the user, in cloud storage, or in the surface's own backend? Locality has privacy and portability implications. Cloud has convenience and multi-device implications. Likely answer is locally-authored, optionally synced — but the trust model needs careful design.]`

### 2.6 The Monday-8am moment (concrete design exercise)

The following describes one concrete moment of using the surface — Monday morning, opening the surface, Primordia operations context. This is the design exercise that grounds the abstractions above.

**Context.** It is Monday, 8:00am. Mikel opens the surface. The surface has been running passively over the weekend, watching standing concerns (drone fleet health, customer communications, infrastructure status). The Primordia operations agent is loaded.

**Default state.** The render field is not empty. According to `agent.md`, the default morning composition includes: a fleet status map, an anomaly timeline for the past 72 hours, a weather window indicator for today's planned inspections, a customer communications inbox. The composition is rendered when the surface opens, before any input from Mikel.

**Conversation panel state.** The agent has authored a brief, three-sentence morning summary. ("Fleet is at 14 of 16 drones active. Two drones flagged anomalies on Saturday — Drone 7 hardware vibration, Drone 12 telemetry gap. Weather window for today opens at 10:30am.") Below the summary is a list of 0-3 items the agent flags as needing attention. The conversation panel is otherwise quiet.

**First interaction.** Mikel reads the brief, taps Drone 7's anomaly. The render field recomposes: now centered on Drone 7, showing its telemetry timeline for Saturday, a comparison to its baseline, two similar past anomalies pulled from history, and the recommended action with confidence level. The agent in the conversation panel contextualizes briefly. Mikel asks "ground it for diagnostic" by voice. The agent confirms (this is a write action, requires approval per `agent.md`), Mikel approves, the agent dispatches the action to the fleet management server agent, the action completes, the render field updates Drone 7's status to "grounded — diagnostic queued."

**State after.** The render field is now showing the post-action composition: Drone 7 grounded, fleet status updated, the alert resolved, the next priority (Drone 12 telemetry gap) elevated. The audit log records the entire sequence. The conversation panel returns to ambient.

This describes one moment. The design grammar is what makes hundreds of similar moments — across Primordia, Legacy Cleanout, and any other operator domain — feel coherent without being templated.

`[OPEN QUESTION: this design assumes voice plus tap as primary modalities. Is that right for an operator at a desk? At a job site? On a phone? The design grammar likely needs modality-awareness baked in.]`

### 2.7 Visual and interaction language

The design language is a separate craft from the architecture and deserves its own deep design pass. Notes for that future work:

The surface should feel calm. Operators carry cognitive load; the interface should reduce it, not add to it. This argues for low chroma in defaults, type-driven hierarchy, generous whitespace, and motion only when motion is informative.

The surface should feel honest. Composed views can hallucinate or mislead if poorly designed. Provenance must be lightweight to access (one tap, one gesture) without being intrusive in the default view. Confidence levels should be expressible without being noisy.

The surface should feel composable. The user should sense that views are being assembled, not delivered. This affects micro-interactions: the way elements arrive on screen, the way recompositions happen, the way the agent's authorship is visible without being theatrical.

The surface should be cross-platform. Operators move between desktop, tablet, mobile, and increasingly mixed reality. The same composition logic should produce coherent views across modalities, with primitives that adapt rather than separate apps for each platform.

`[RESEARCH NEEDED: visual design precedents — Bloomberg Terminal, Figma, Linear, Arc, Things, Notion. What works at high information density without becoming hostile? What feels alive without becoming distracting?]`

---

## 3. The strategic position

### 3.1 What we are building

A user-facing render surface plus a default general-purpose carrier, both built on top of MCP and emerging agent-to-agent protocols.

The product is the *experience* humans have when operating through agents — the surface, the design grammar, the configuration substrate, the audit and trust layer, the composition runtime. Plus the default carrier that handles general-purpose discovery and routing for users who do not opt into specialist carriers.

### 3.2 What we are explicitly not building

**Not the agent-to-agent protocol itself.** Anthropic, Stripe, Visa, OpenAI, Coinbase, and others are shipping the protocol layer. We use what they ship and contribute to standards rather than competing with them. Reference implementation, not protocol owner.

**Not the long tail of capability servers.** We do not build CRM integrations, drone fleet APIs, or vertical service backends. Server agents are an ecosystem, exposed through MCP and similar protocols. We integrate with the ecosystem rather than building it.

**Not vertical carriers.** Vertical specialists (real estate carrier, medical carrier, logistics carrier) will be built by domain experts who know those domains. We support them via the protocol and integrate them via the carrier-pluggability model. Our carrier work is the general-purpose default.

**Not a chat product.** The conversation panel is not a chatbot. The product is the composed surface. Chat-only competitors are solving a different problem.

**Not a browser replacement aimed at consumers first.** The wedge is operators — people whose work justifies the cognitive load of learning a new surface. Consumer adoption follows operator adoption, not the other way around.

### 3.3 The wedge: operator surfaces first

Consumer agent surfaces are crowded (Perplexity, Arc, Dia, Comet, ChatGPT, plus dozens of startups). Operator surfaces are less crowded, the workflows are stickier, the transactions are higher-value, and the buyers (in the acquisition sense) understand operator software economics.

The first concrete operator domain is Primordia operations — fleet, missions, telemetry, customer reports — because Mikel is customer zero, the data is rich, and the composition problem is hard enough to reveal the design grammar.

The second concrete operator domain is Legacy Cleanout — jobs, leads, field crew, follow-ups — because it is operationally live, the data is different in shape, and successful generalization across two domains demonstrates that the runtime is real.

Beyond those two: any operator role currently spending hours per day fighting with containers — dealership floor managers, dispatch coordinators, hospital administrators, field service supervisors, small business owners running multiple tools.

### 3.4 The acquisition path

This is being designed with a specific exit window in view. Realistic acquirers, in approximate order of strategic fit:

**Microsoft** — most strategically rational buyer. Has Copilot but constrained by Office/Windows shapes; wants to de-risk OpenAI dependency; has enterprise distribution that matches the operator wedge; has done large strategic acquisitions (GitHub, LinkedIn, Activision) competently.

**Google** — most threatened, deepest pockets, most likely to overpay defensively. Strategic anxiety: post-search agent surfaces threaten the search advertising business directly. Risk: internal politics around search make integration painful for the acquired team.

**Apple** — behind on agents, has all the money, has been showing more openness to acquisition under AI pressure. Best price if they want it; lowest probability they actually want it.

**OpenAI** — wildcard. Has the model and wants the surface but is more likely to build than buy. Would only acquire if convinced the team has cracked something they have not.

**Anthropic** — less likely at scale, but worth noting because they are shipping the protocol substrate this is built on. Cultural and technical fit would be high.

**Stripe** — long shot. They are shipping the payment/identity substrate. If the surface drives meaningful agent transaction volume, they would have strategic interest. Private and cash-conscious; probably not the highest bidder.

The exit window is approximately 18-30 months from product launch — long enough to accumulate meaningful traction, short enough that the strategic threat is still pre-existential to the buyer.

### 3.5 What "good enough to be acquired" means concretely

Acquisitions at the scale being targeted require legibility, not just user love. Specifically:

**Measurable disruption of an incumbent's specific revenue source.** "DAUs growing fast" is not enough. The metric needs to map to the buyer's strategic anxiety. For Google: agent-mediated discovery queries that would have been Google searches. For Microsoft: enterprise operator hours moved off Office/Copilot onto our surface. For Apple: cross-platform reach in markets they care about. The metric pipeline needs to be designed into the product from day one.

**Defensibility that justifies buying versus copying.** The technical pieces are increasingly easy to replicate. The defensible asset is the *design grammar* (patterns users have learned), the *composition data* (what the system has learned about which compositions work for which intents), and the *brand and trust* (users have placed their operations in this surface). The Wiz, Beats, Instagram, Looker pattern.

**Clean integration with the buyer's existing stack.** The protocol decisions made early matter for acquisition price later. MCP-native, ACP-aware, x402-compatible, App Intents-friendly. Open standards as both technical and acquisition-friendly choice.

**Multi-buyer credibility.** Acquisition prices get pushed up when the buyer is afraid a competitor will buy first. The product positioning must be plausibly attractive to multiple buyers simultaneously, which means avoiding design or branding that locks too tightly to any one of them.

**A founder narrative that acquirers can metabolize.** Acquisitions at this scale partly acquire the founder. The narrative needs to be visible and legible: 13 years self-taught, 23 products shipped, brain injury recovery, Waffle House turnaround, building Primordia solo for 18 months, recognizing the post-container shift early. This is part of the strategic surface, not separate from it.

### 3.6 The lab framing

Primordia Systems remains the parent thesis. The render surface is one experiment under the lab — a different shape from the cognitive-architecture work and the physical-world drone work, but consistent with the overall mission of operating at the substrate of how humans and intelligent systems work together.

The lab framing matters because it lets the surface project be pursued without abandoning Primordia's other work, and it makes the eventual acquisition narrative coherent — "Primordia Systems is a lab building multiple experiments at the human-agent interface; this acquisition takes one of them to the next stage."

`[OPEN QUESTION: does the surface project warrant being its own brand under the Primordia umbrella, or shipped under the Primordia name directly? Naming and brand architecture decisions deferred until the shape is firm.]`

---

## 4. Design tensions and open questions

This section names the trade-offs and unresolved questions that the research and design work needs to address. These are not blockers — many of them will only resolve through prototyping and observation. Naming them keeps them from being skipped.

### 4.1 Composition versus consistency

A composed surface is generated for the moment. A consistent interface is the same every time. Users need both. Too much composition and the surface feels chaotic and unlearnable. Too little and the value of composition is lost.

The likely answer is *consistent affordances, composed content* — the gestures, the patterns, the visual language are stable; what gets composed inside that frame is dynamic. But this needs design exploration, not just assertion.

### 4.2 Agent visibility

The agent doing the composing is invisible? Visible? Voiced? Cursored? Visible agents tend to feel intrusive (Clippy). Invisible agents tend to feel magical when working and infuriating when failing.

Hypothesis: mostly invisible, with a clear handle when the user needs to interrogate or correct. The conversation panel is the agent's primary visible presence; in the render field, the agent's authorship is shown through composition choices, not through avatars or voice.

`[RESEARCH NEEDED: what works for ambient AI presence? Apple's design language for Apple Intelligence, Google's for Gemini, Microsoft's for Copilot. What patterns are emerging? What is failing?]`

### 4.3 Persistence and state

When the user closes the surface and reopens it, what persists? Pure stateless feels exhausting. Pure stateful becomes a container.

Likely answer: layered persistence. An ambient layer of standing concerns and pinned views (always there). An ephemeral layer of in-progress exploration (cleared between sessions unless explicitly persisted). A historical layer of past compositions (interrogable, replayable, but not loaded by default).

### 4.4 Trust and provenance UI

How does the user know to trust what they see? Composed views from multiple sources can mislead. The provenance must be accessible without being noisy.

Hypothesis: confidence is visible without being obtrusive (subtle indicators), source is one tap away (x-ray mode), the audit log is queryable in natural language ("how did you decide that?"). But this is a place where design and research need to walk together — getting this wrong loses trust irrecoverably.

### 4.5 Multiple agents, one surface

Operators have multiple roles. Mikel operates Primordia, Legacy Cleanout, and Apex from the same body. Are these separate "spaces" with separate user agents? One unified user agent that switches contexts? Some hybrid?

Hypothesis: separate `agent.md` files for separate operating contexts, one underlying user agent that loads the right context. Switching is explicit (because mixing contexts dangerously cross-contaminates) but lightweight.

### 4.6 Graceful failure

What does the surface look like when things break? When a server agent is unreachable? When a carrier returns garbage? When the user agent's composition produces a view that does not actually answer the intent?

Failure modes are the test of any new interface. Containers fail well because users know what to expect. Composed surfaces have to design failure as carefully as success.

### 4.7 Privacy and data flow

The user's intent, context, and `user.md` are sensitive. What flows out of the user agent to carriers and server agents? What stays local? How is identity protected from server agents that do not need to know who is asking?

This is where privacy carriers (mentioned in the carrier model) become important. But the default behavior — what flows where, when the user has not configured anything — needs careful design and probably regulatory awareness.

`[RESEARCH NEEDED: how are agent commerce protocols (ACP, MPP, TAP) handling identity and privacy today? What regulatory frameworks are emerging? GDPR-equivalent for agent-mediated transactions?]`

### 4.8 The "first agent" problem

The user's first interaction with the surface is awkward. There is no `user.md` yet. The user agent has no context. Defaults are necessarily generic.

Onboarding design is its own problem. Probably involves a conversational onboarding that drafts an initial `user.md` collaboratively, plus pre-built `agent.md` templates for common operator roles (small business owner, fleet manager, sales operator) that can be edited rather than written from scratch.

### 4.9 The carrier marketplace

If carriers are pluggable, who decides which carriers are trustworthy enough to ship as defaults? How does a new specialist carrier get discovery and adoption? Is there a carrier marketplace? Is it curated or open?

This is partly a platform design question and partly a business model question. Avoiding both extremes (locked-down App Store rent extraction; uncurated wild west) probably means a tiered model — verified carriers, community carriers, experimental — with clear trust signals to users.

### 4.10 Pricing and business model

The surface is a thick client. Users pay for it directly? Operators pay per-seat? Carriers pay for placement? Server agents pay for being routed to? Some combination?

Hypothesis (loose): operators pay seat-based subscriptions for the surface; carriers may pay for verified placement (with disclosure); transaction volume routed through the surface generates downstream revenue from agent commerce protocols (ACP, x402). But this needs significantly more thought.

`[RESEARCH NEEDED: how are operator-software businesses pricing in 2026? What works for high-engagement, high-trust products? Linear, Notion, Figma pricing patterns; vertical software like ServiceTitan, Procore.]`

---

## 5. Research agenda

This section lays out what needs to be researched before serious building begins. Priority ordering reflects what most affects design decisions, not what is most academically interesting.

### Priority 1: Competitive landscape (deep)

**Browser-shaped agent products.** Arc Search, Dia (Browser Company), Comet (Perplexity), Strawberry, Sigma, every YC batch's AI browser. What shapes are they trying? Where are they constrained by the browser frame? Where are they breaking out of it? What can be learned about user response from their adoption curves?

**Chat-shaped agent products.** ChatGPT, Claude, Gemini, Copilot. How are they evolving toward agent surfaces? What are the limits of the chat shape? Where is generative UI emerging (canvas, artifacts, v0)?

**Operator-shaped agent products.** Cursor (for developers), Linear's AI features, Notion AI, Salesforce Einstein, vertical SaaS adding agent layers. How are they evolving from container to composed?

**Browser automation startups.** Browserbase, Steel, Anchor Browser, Browser Use, Reworkd. They are circling the agent-native execution layer. Their constraints reveal what the substrate looks like underneath the surface.

**Generative UI prior art.** Vercel v0, Claude artifacts, ChatGPT canvas, GitHub Copilot Workspace, anything from Adept before the acqui-hire. What works? What doesn't? Where are the patterns stabilizing?

### Priority 2: Protocol and infrastructure

**MCP deeply.** Anthropic's documentation, the spec, the SDK, the registry, the patterns emerging from real-world MCP servers and clients. What does it actually take to be MCP-native at the surface level? What are the gotchas? What is being added in active development?

**ACP, MPP, x402, TAP.** Stripe's documentation, Visa's TAP spec, Coinbase's x402, Google's AP2, Anthropic's stance on commerce protocols. How are these composing? What is the realistic integration path for a render surface?

**Identity and authentication.** Stripe Link Agent Wallet, Visa TAP for agent identity, OAuth-for-agents patterns, scoped credential delegation (SPTs). What is the state of the art? What is missing?

**Capability discovery.** How do user agents find the right server agents today? MCP registries, marketplaces, custom indexes. What is the agent-native equivalent of DNS plus search?

### Priority 3: Operator software and case studies

**Bloomberg Terminal.** Probably the closest existing analogue to a high-density operator surface. What is its design grammar? What works at extreme information density? What are operators willing to learn?

**Linear, Notion, Figma.** Modern operator-grade tools with strong design languages. What patterns generalize? Where do they each push the form forward?

**Vertical operator software.** ServiceTitan (field service), Procore (construction), Epic (medical), Veeva (life sciences). How does deep operator software earn its keep? What does it cost an operator to switch?

**Air traffic control, command-and-control systems.** Highest-stakes operator surfaces. What does decades of UX research at extreme stakes reveal?

### Priority 4: Visual and interaction design

**Calm interface design.** Edward Tufte's information design work, Don Norman's affordance theory, contemporary practitioners (Linear's design team, Things, Arc). What does calm look like at high information density?

**Cross-platform design grammar.** Apple's HIG evolution, Material Design 3, Fluent. What patterns hold across desktop, mobile, tablet, and emerging mixed-reality?

**Motion and feedback.** When does motion inform versus distract? What patterns are emerging from agent UIs specifically (typing indicators, generation animations, live updates)?

**Trust UI patterns.** How do products express confidence, uncertainty, provenance, and audit without overwhelming the default view? Bloomberg's data quality indicators, Wikipedia's citations, news aggregators' source signals.

### Priority 5: Acquisition comparables and strategic positioning

**Recent strategic acquisitions in adjacent spaces.** Wiz/Google, Looker/Google, Beats/Apple, GitHub/Microsoft, Activision/Microsoft, Figma/Adobe (failed). What were the strategic anxieties? What did the buyers actually pay for? How did the founders position their companies?

**Browser company history.** Netscape, IE, Firefox, Chrome, Safari, Edge, Opera, Brave, Arc. How did each rise and fall? What does the history reveal about defensibility in a substrate position?

**Operator software exits.** ServiceTitan, Veeva, Procore, Snowflake. How did vertical operator software win? What were the moats?

`[NOTE: this research is substantial — likely 30-60 hours of focused work to do well. It can be parallelized across a few research sessions, each producing a synthesized briefing.]`

---

## 6. First experiments

The question is not whether to do research first or build first. It is what to research, what to design, and what small things to build that test the most uncertain pieces of the thesis.

Three candidate first experiments, in increasing scope:

### Experiment A: Internal Primordia operator surface

Build a minimal render surface for Primordia operations only. One operator (Mikel). One context (`agent.md` for Primordia). MCP integration with Primordia's existing systems. Default composition primitives (map, timeline, alert, narrative). No carrier layer yet — direct user-agent-to-server-agent calls.

**What this tests.** Whether the composition runtime works for a real operator on real data. Whether the design grammar feels right under actual workload. Whether `user.md` and `agent.md` are the right configuration substrate or whether they need to be different.

**What this does not test.** The carrier layer. Multi-context handling. The acquisition narrative. The cross-domain generalization.

**Time/cost.** Probably 3-6 months with a small team. Cheap relative to value of the learning.

### Experiment B: Internal plus Legacy Cleanout surface

Add Legacy Cleanout as a second operator context. Same surface, second `agent.md`, different data shape. Begin to extract design grammar that holds across both domains.

**What this tests.** Whether the runtime generalizes across operator domains, or whether it is implicitly designed for Primordia and breaks on Legacy. The cost of adding a new context (which becomes the cost of onboarding any new operator domain).

**What this does not test.** External users. The carrier marketplace. The acquisition narrative.

**Time/cost.** Adds 2-4 months on top of Experiment A.

### Experiment C: Open beta with a small set of external operators

Ship the surface to 10-50 external operators in selected verticals. Real `user.md` and `agent.md` authoring. Real composition under conditions we cannot predict. The first carrier infrastructure (just the default general-purpose carrier).

**What this tests.** Adoption with users who do not have founder context. Onboarding cost. The first signal of which design choices are right and which are quirks of being customer zero.

**What this does not test.** Scale. The full carrier ecosystem. Acquisition-readiness metrics.

**Time/cost.** 3-6 months on top of Experiment B, plus infrastructure costs.

### Recommendation

Start with Experiment A. Resist the temptation to skip to C. The design grammar has to be discovered, not asserted, and the only way to discover it is to use the surface for real work. Mikel as operator zero is a feature, not a bug — it means feedback is fast, the data is rich, and the cost of being wrong is low.

Move to Experiment B when Experiment A is producing real operator value (not just demos) and the design grammar feels stable enough to test on a different domain.

Move to Experiment C when Experiment B has validated cross-domain generalization. By then, the acquisition window analysis will be sharper, and the open beta becomes the start of the traction story.

`[OPEN QUESTION: should any of these experiments be public from the start, even as alpha, to begin building the acquirer-visible narrative? Trade-off between learning fast in private and building public traction.]`

---

## 7. What this document does not cover

For honesty: things that are part of building this product but are deliberately deferred from this draft.

- **Team and hiring.** Founding team composition, key hires, advisor structure. Mikel's brother-in-law at Blue Origin has been mentioned as a potential technical advisor; that conversation is its own thread.
- **Funding strategy.** Bootstrap, angel, seed, strategic investors. The acquisition framing has implications for funding (high-priced strategic rounds versus capital-efficient bootstrapping; both are viable, with different trade-offs).
- **Legal and corporate structure.** Whether this lives inside Primordia Systems LLC, becomes a subsidiary, spins out. IP allocation. Contractor versus employee structures.
- **Detailed financial modeling.** Burn, runway, revenue projections, exit modeling. Premature given how much design and research is still ahead.
- **Marketing and positioning.** Naming, brand, launch sequencing, content strategy. Premature; will be designed after the product shape stabilizes.
- **Specific technical architecture.** Languages, frameworks, hosting, scaling. The design document is at the level of behavior and shape; implementation choices follow research.

These are real gaps. They become the next layers of work once the design and research foundations are in place.

---

## 8. The honest caveat

This document captures a thesis the author finds compelling and a design that follows from it. Both could be wrong.

The thesis depends on the post-container shift happening on roughly the timeline assumed, with the protocol layer maturing, the incumbents staying trapped, and operator surfaces being a viable wedge. Each of these is plausible but not certain. The research agenda is partly designed to test these assumptions before significant building.

The design depends on composition runtimes being technically achievable at the quality this product needs, on operators being willing to learn a new surface, and on the acquisition window staying open long enough to matter. Each has risks worth tracking.

The strategic position depends on staying focused on render and carrier (not protocol), staying out of the consumer-first race, and on accumulating the right traction metrics for acquirer legibility. Discipline is the failure mode here — scope creep is a real risk.

This document is a starting point. The next stage is research, then design iteration on the open questions, then Experiment A. The thesis becomes truer or falser as the work proceeds. The right disposition is committed but updateable.

---

*End of working document. Version 0.1, May 2026. Edits welcome.*
