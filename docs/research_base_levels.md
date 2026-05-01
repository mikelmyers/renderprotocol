# Render Surface — Base-Level Research

**Companion to:** `render_surface_design_document.md`
**Status:** Base-level pass complete across all five research priorities. Deep dives flagged where needed.
**Date:** May 2026
**Method:** Web search and synthesis. Citations preserved. Conflicts and gaps named explicitly.

---

## How to read this document

This is a foundation, not finished analysis. Each section establishes the factual landscape — what exists, who is building what, what the state of the art is — and ends with implications for the design document. Strategic synthesis (Section 6) pulls the threads together. Open gaps for deeper research (Section 7) are listed at the end.

**The most important finding upfront:** the strategic landscape is significantly different from what the design document assumed, and three specific facts force material updates. These are flagged inline and consolidated at the end.

---

## 1. Competitive landscape

### 1.1 AI-integrated browsers — the crowded category

Six serious products are now actively competing in the AI browser space, each making different bets. The category is moving faster than any browser cycle since Chrome.

**ChatGPT Atlas (OpenAI), launched October 21, 2025.** Chromium-based, macOS-only at launch, with Windows/iOS/Android in development. The flagship feature is "agent mode," where ChatGPT navigates websites and performs multi-step tasks on the user's behalf — researching, automating, planning, shopping. OpenAI has positioned this explicitly as a step "toward a future where most web use happens through agentic systems—where you can delegate the routine and stay focused on what matters most." Agent mode is in preview for Plus, Pro, and Business users. Atlas is being combined with the ChatGPT app and Codex into a single unified desktop application — OpenAI's "SuperApp" direction. (Sources: OpenAI announcement, Wikipedia, multiple reviews)

**Perplexity Comet, launched mid-2025.** Originally $200/month via Perplexity Max, now free with paid tiers ($20/mo Pro, higher Max tier). Strong at agentic task execution, particularly form-filling and multi-step web tasks (~85% success rate on simple tasks per LLMx review). Perplexity has launched "Comet Plus" — a publisher revenue-sharing program that pays publishers for human visits, search citations, AND "agent actions," explicitly recognizing three types of internet traffic. This is a meaningful structural innovation: a business model that compensates content creators in a world where agents do the consuming. (Sources: Perplexity blog, eesel AI, USAII)

**Dia (The Browser Company, now Atlassian).** Acquired by Atlassian for $610M in cash, September 2025. Dia is the AI-first successor to Arc; Arc development was wound down because it was "too complex for most people to adopt." Atlassian is integrating Dia with Jira, Slack, Notion, Google Calendar, Gmail, Amplitude, and Linear (which Atlassian also acquired). Dia features a "Morning Brief" (calendar, inbox, key links) and "Proactive Suggestions" — language remarkably close to what the design document describes. The acquisition price represented only a modest premium over their $550M Series B valuation, suggesting Atlassian got it relatively cheap. (Sources: Wikipedia, TechCrunch, Skywork)

**Project Mariner (Google DeepMind), announced December 2024, expanded at Google I/O May 2025.** Achieved 83.5% on WebVoyager benchmark. Features "Teach & Repeat" workflow learning, can run up to 10 parallel tasks in cloud-hosted browsers. Now integrated as "Agent Mode" in the Gemini app. Google is positioning Mariner as the agentic foundation across the Gemini ecosystem — Mariner for the digital world, Astra for the physical world. Notably, despite the announcements, Mariner has no published model card, no benchmark numbers beyond WebVoyager, no API, and limited public access. One analysis suggests this is because reliability isn't yet shippable. (Sources: Google DeepMind, Wikipedia, ucstrategies)

**Brave Leo, Opera Neon, Microsoft Edge with Copilot, Arc Max.** Smaller players occupying privacy, power-user, or ecosystem-specific niches.

**BrowserOS, Phi Browser, Genspark AI Browser, HERE Enterprise Browser.** Emerging open-source and enterprise-specialized entrants.

The pattern across all of these: they are all keeping the browser frame and adding agents inside it. None has yet shipped the post-container "render surface" shape the design document describes. This is consistent with the design document's premise that incumbents are trapped by the browser shape — but it also means the category is *very crowded* with people circling adjacent shapes.

**[GAP]** No public product yet ships the specific "agent-only client, render field composed from agent responses" pattern the design document describes. This is either a real opportunity or a sign that the shape isn't yet viable. Probably the former, but worth deeper testing.

### 1.2 Browser automation infrastructure

The substrate beneath agent browsers is now a real category with real funding.

**Browserbase**, founded January 2024 in San Francisco. Raised $67.4M total, $40M Series B at $300M valuation in June 2025 (Notable Capital led). Over 1,000 customers including Perplexity and Vercel. Processed 50 million browser sessions in 2025. Provides cloud-hosted headless browsers optimized for AI agents — "AWS for headless browsers." Their Stagehand framework translates natural language into browser actions. They also publish an MCP server. CEO Paul Klein's framing: "AI is going to get so smart that it's able to use the internet for you" — explicitly betting on the agent-uses-existing-web pattern, not the agent-native-protocol pattern. (Sources: PitchBook, Tracxn, Upstarts Media)

**Steel.dev** — Open-source-leaning competitor with generous free tier. Strong for self-hosted browser automation.

**Kernel** — Series A, $22M from Accel. Differentiates with unikernel-based architecture achieving <325ms browser startup (vs 3-5s for container-based competitors). Targeting agent authentication specifically.

**Bright Data** — Long-time proxy infrastructure player, repositioned for the agent era. 400M IPs, sophisticated anti-detection.

**Browserless, Scrapfly** — Established providers expanding into agent use cases.

The whole infrastructure layer is being built by people who assume agents will keep using the existing web rather than that the web will be replaced. This is the "we're not going to rewrite the whole internet for AI" thesis. It's the conservative bet, and it's where the money is currently going.

### 1.3 Generative UI prior art

Several products are already shipping generative UI in narrow forms.

**Vercel v0** — Generates React components from natural language. Early example of "interface composed for the question."

**Claude artifacts** — Renders interactive content inline in chat conversations. The pattern of "chat plus rendered surface alongside" that the design document describes is already shipping in Claude.

**ChatGPT Canvas / OpenAI Apps SDK** — OpenAI's Apps SDK (launched November 2025) enables developers to build rich, interactive applications inside ChatGPT, with MCP as the backbone.

**GitHub Copilot Workspace** — Generates structured plans and actionable artifacts for coding tasks.

**MCP-UI / mcp-ui** — Community project pioneering interactive UI delivery via MCP, adopted by Postman, Shopify, Hugging Face, Goose, ElevenLabs.

This is the most important finding of the entire research pass and it deserves its own section.

---

## 2. Protocol and infrastructure

### 2.1 MCP — the standard has won

The Model Context Protocol has had one of the fastest open-source protocol adoption curves in history. Key facts:

- Launched November 2024 by Anthropic
- 2M monthly SDK downloads at launch → **97 million monthly downloads by March 2026** (970x growth in 18 months, faster than Kubernetes)
- **10,000+ active public MCP servers** by December 2025; independent census from Nerq counted 17,468 by Q1 2026
- All major providers shipped support: OpenAI (April 2025), Microsoft Copilot Studio (July 2025), AWS (November 2025), Google
- **December 9, 2025: Anthropic donated MCP to the Agentic AI Foundation**, a directed fund under the Linux Foundation, co-founded by Anthropic, Block, and OpenAI, with support from Google, Microsoft, AWS, and Cloudflare. MCP is no longer Anthropic's protocol; it's the industry's protocol.
- April 2026: AAIF held the MCP Dev Summit North America in NYC, ~1,200 attendees
- Forrester predicts 30% of enterprise app vendors will launch their own MCP servers in 2026; Gartner predicts 40% of enterprise applications will include task-specific AI agents by end of 2026

This means the design document's choice to be "MCP-native" is correct, but the strategic framing around it needs sharpening. MCP is not an emerging protocol that Anthropic is shipping — it is *settled industry infrastructure* on the same governance footing as Linux, Kubernetes, and PyTorch. The protocol question is not "will MCP win" — it has won.

### 2.2 MCP Apps — the critical finding

**This is the most important single piece of research.** On November 21, 2025, Anthropic and OpenAI co-published SEP-1865: "MCP Apps Extension." The specification was finalized as MCP's first official extension and **officially released January 26, 2026.**

What MCP Apps does, in the words of the spec:

> "MCP Apps introduces a standardized pattern for declaring UI resources via the ui:// URI scheme, associating them with tools through metadata, and facilitating bi-directional communication between the UI and the host using MCP's JSON-RPC base protocol."

In plain terms: MCP Apps lets MCP servers deliver interactive UI elements (HTML, dashboards, forms, charts, data visualizations) that render inline in MCP host applications (Claude, ChatGPT, VS Code, others). The host fetches the UI resource, displays it in a sandboxed iframe, and bidirectional communication flows over JSON-RPC.

This is, structurally, a substantial portion of what the design document describes the "render field" doing. Not all of it — the design document goes further on operator-surface composition, multi-source agent assembly, audit and replay, and the configuration substrate. But the *core mechanism* of "agent returns structured UI, host renders it in conversation" is now standardized and shipping.

Quotes from the announcement confirm the framing:

> "MCP Apps address a real gap between what agentic tools can provide and how users naturally want to interact with them. The ability to render dynamic interfaces directly in conversation makes it easier to leverage MCP server capabilities in practical ways." — Clare Liguori, Senior Principal Engineer, AWS

> "The model stays in the loop, seeing what users do and responding accordingly, but the UI handles what text can't: live updates, native media viewers, persistent states, and direct manipulation. Combined, they provide the model and user with all the context they need in one familiar interface." — MCP Apps blog post

The Register's coverage was even more direct:

> "The change makes Claude's chat environment more like a cross-application interface layer — users no longer have to switch application focus to access app-specific tools. It could pose a challenge to operating system makers like Apple, Google, and Microsoft, similar to the one presented by web browsers."

Hosts supporting MCP Apps at launch: Claude (Web and desktop, Pro/Max/Team/Enterprise), VS Code (Insiders), with Goose and ChatGPT integration in progress.

**This forces a major update to the design document.** What we were calling the render surface is, in significant part, an MCP Apps host — a place where MCP Apps render. The differentiation is what the *host* does on top of the protocol: composition across multiple sources, the operator-surface focus, the audit and provenance system, the configuration substrate, the carrier model. The protocol piece is solved.

### 2.3 Agent commerce protocols

Multiple protocols have shipped for agent payments and commerce:

- **ACP (Agentic Commerce Protocol)** — Co-developed by OpenAI and Stripe, launched September 2025 alongside ChatGPT Instant Checkout. Defines message flow between agent and merchant. Uses Shared Payment Tokens.
- **MPP (Machine Payments Protocol)** — Stripe + Tempo, announced at Sessions 2026 (April 29, 2026). Enables agents to make payments via stablecoins or fiat through the PaymentIntents API.
- **x402** — Coinbase-developed open standard, integrated by Stripe February 2026. Repurposes HTTP 402 status code for payment-required workflows. Supports USDC on Base, Solana, Tempo. As of April 2026, x402 stablecoin path remains in preview, US businesses only.
- **TAP (Trusted Agent Protocol)** — Visa's protocol that signs agent identity into HTTP request headers. Solves the agent authentication problem.
- **Link Agent Wallet (Stripe)** — Consumer-side, lets users delegate spending to AI agents through real-time approvals, one-time-use cards, and scoped payment tokens. Launched at Sessions 2026. Supports Claude, OpenAI agents, custom agents.
- **AGENTS.md (OpenAI)** — Markdown convention giving AI coding agents repo-specific instructions. (Worth flagging: the design document's `agent.md` is convergent with an existing emerging pattern.)

This validates the design document's framing that the protocol layer is being built by others. All of this composes — Visa TAP-signed requests carrying SPTs through ACP gives merchants both authenticated agent identity and scoped fraud-monitored payment credential.

**[GAP]** Discovery and reputation protocols remain undefined. Capability registries exist (PulseMCP, MCP.so, MCPMarket.com listing 5,500+ servers as of October 2025) but there is no neutral protocol-level registry the way DNS works. This is the layer the design document called the "carrier" — and it is genuinely open.

### 2.4 Identity, auth, and security

Major issues remain unresolved across the agent infrastructure stack.

- The MCP 2026 roadmap prioritizes moving from static secrets to SSO-integrated authentication and standardized audit trails, but DPoP and Workload Identity Federation are still on the horizon.
- The OpenSSF AI/ML Security Working Group launched **SAFE-MCP** in 2026, cataloging 80+ attack techniques targeting tool-based LLMs. Key threat vectors: prompt injection, confused deputy attacks, context integrity failures.
- Six critical CVEs in MCP's first year; 43% of servers reportedly vulnerable to command injection.
- Browserbase + 1Password partnered (October 2025) on credential delegation for agentic AI — early sign of identity infrastructure forming.
- Browserbase + Cloudflare launched "Web Bot Auth Framework" (August 2025) for AI agent identity verification — another early sign.
- Atlas had a documented "ChatGPT Tainted Memories" vulnerability in October 2025 (CSRF + prompt injection through browser memory feature).
- The Agentic AI Foundation's enterprise readiness work targets these issues; expect most to land as MCP extensions rather than core spec changes.

**[GAP]** Agent identity is genuinely unsolved at the protocol level. Visa TAP exists but isn't widely adopted. This is real opportunity space — but also real risk space, because security failures here are catastrophic.

---

## 3. Operator software

This priority is the thinnest of the base research because it overlaps heavily with our existing knowledge of these products and the search results were less specific. Notes:

- Bloomberg Terminal remains the canonical operator surface — high information density, customizable layouts (panels), professional learning curve. Operators willingly pay $24,000+/year per seat. Pre-built containers with operator customization, not composed.
- Linear, Notion, Figma — modern operator-grade SaaS, strong design languages, but all containers (defined product shapes the user adapts to).
- ServiceTitan, Procore, Veeva, Epic — vertical operator software, deep moats, high switching costs, container-shaped.
- Air traffic control / command-and-control systems — highest stakes operator surfaces; relevant for design pattern research but specific case studies were not surfaced in this base pass.

**[DEEP DIVE NEEDED]** Operator software case studies need a focused research pass: how operators actually use Bloomberg, what design patterns work at high information density, what crosses the line into "too dense to learn." This is critical for the design grammar work.

---

## 4. Visual and interaction design

Insufficient findings in this base pass. The general competitive landscape and protocol research consumed more time than expected. Relevant pointers:

- Calm interface design (Linear, Things, Arc) — established design language but documentation thin in search results
- Apple HIG, Material Design, Fluent — known foundations but specific evolution under generative UI not surfaced
- Trust UI patterns (Bloomberg data quality, news source signals, citation systems) — partial signal from Comet's "every answer links back to sources" approach

**[DEEP DIVE NEEDED]** This is the second-priority deep dive after operator software. The design grammar is the defensible asset; researching prior art carefully is worth significant focused time.

---

## 5. Acquisition comparables and strategic positioning

### 5.1 The acquisition environment is unprecedented

Several facts that materially affect the design document's acquisition framing:

- **Q1 2026 saw $300 billion in global venture investment**, an all-time record. AI accounted for $242B (80%) of total funding.
- **Tech M&A jumped 77% YoY in 2025**, reaching ~$1.08 trillion. Almost half of strategic technology deal value above $500M came from AI-native companies, doubled from ~25% in 2024.
- **CB Insights reported 266 AI M&A deals closed in Q1 2026** — 90% YoY increase.
- **AI acquisitions command 24x revenue multiples on average** vs 12x for traditional software.
- 2025 alone saw 33 major AI/data acquisitions totaling $157B+ in disclosed value.
- **Sapphire Ventures predicts a $50B+ acquisition of a private market software company in 2026.** They specifically flag: "code assistants, data management, security, fintech and sub-scale labs" as candidate categories.

### 5.2 Recent comparable transactions

Specific deals that establish precedent:

- **Google → Wiz, $32B** (March 2024). Cloud security + AI threat detection. Largest ever acquisition of a private US venture-backed company. Set the template for "incumbent buys threat to neutralize it."
- **Atlassian → The Browser Company, $610M** (September 2025). Most directly relevant: an enterprise software incumbent buying an AI browser company specifically to shore up its position. Modest premium over $550M valuation — Atlassian got it cheap, but TBC also exited at a price point that's instructive.
- **Salesforce → Informatica, $8B** (May 2025). "Agent-ready data platform" framing — Benioff explicitly positioning the deal for the agentic AI era.
- **OpenAI → io Products, $6.5B** (Jony Ive's hardware startup that hadn't shipped a product). Acqui-hire of design talent at scale.
- **Meta → Scale AI, $14.3B** investment (acqui-hire structure).
- **AMD → ZT Systems, $4.9B**. Vertical integration play.
- **Palo Alto → CyberArk, $25B**. Identity + AI integration.
- **OpenAI** has made 7 acquisitions in 2026 already (as of mid-April), nearly matching their 2025 total of 8. Pattern is "operator teams with domain expertise" — Astral (developer tools), Promptfoo (AI testing), Hiro (personal finance).

The Atlassian/Browser Company deal is the most relevant comparable for the design document. Important caveats from it:

- The acquisition price was modest ($610M) relative to the ambition of the product. Browser companies don't yet command Wiz-tier prices.
- The acquirer was an enterprise SaaS company (Atlassian), not a hyperscaler. This expands the realistic acquirer set the design document considered.
- TBC operated independently post-acquisition. This is a viable exit shape if the founder wants to keep building.

### 5.3 What acquirers are paying for

Multiple sources converge on the same insight: acquirers in 2025-2026 are not paying for revenue. They are paying for capabilities that would take years and hundreds of millions of dollars to replicate internally — proprietary data sets, specialized AI talent, trained models, and distribution advantages in specific verticals.

Quote from the FE International analysis:

> "Companies that own proprietary workflows within a specific industry are positioned to attract multiple categories of acquirers, from horizontal SaaS platforms looking to add vertical depth to PE firms executing industry roll-up strategies."

Quote from EY-Parthenon:

> "These tech and talent deals used to be worth tens of millions, and now we are in the billions."

The implications for the design document:

- The acquisition framing is well-founded. The market is real and large.
- Vertical operator workflows are an emphasized buyer category, validating the design document's operator-first wedge.
- "Founder narrative" matters — Mikel's background is a real asset in this market.
- The realistic acquirer set should *expand* to include enterprise SaaS companies (Atlassian-shape buyers), not just hyperscalers and Apple.

### 5.4 What's been said about AI startups that "make smart acquisition targets"

Fortune polled VCs late 2025. Recurring themes:

- **Application-layer companies with proven product-market fit** are obvious targets for foundation model companies.
- **Coding tools** are the most-cited specific category (Cursor, Factory, Codegen, Wrap mentioned).
- **Observability platforms** (Datadog, Sentry-shape) for AI development.
- **Vertical AI tools with strong retention and data advantages** — even at $300K-$800K ARR — finding eager small-PE and operator buyers.

The render surface, framed as an operator-grade interface for agent-mediated work, fits the "vertical workflow + AI-native UX + acquisition-ready" pattern these analysts describe. This is good.

---

## 6. Strategic synthesis — what this research changes

Three findings force material updates to the design document.

### 6.1 MCP Apps changes the differentiation argument

The design document positioned the render surface as exploiting a gap that doesn't yet have a standardized solution. **MCP Apps significantly closes that gap** for the basic mechanism of "agent returns structured UI, host renders it in conversation." This is now industry-standard infrastructure.

The differentiation must shift from *"we render structured agent responses"* to *"we are the host that does X uniquely well on top of MCP Apps":*

- **Multi-source composition.** MCP Apps lets one tool render one UI. The render surface composes across multiple agents, multiple servers, multiple carriers — that is real value beyond the protocol baseline.
- **Operator-surface focus.** Other MCP Apps hosts (Claude, ChatGPT, VS Code) are general-purpose. An operator-grade host — built for fleets, missions, dashboards, audit, multi-context — is genuinely under-served.
- **Audit and provenance as first-class.** Other hosts are bolt-on for trust. An operator surface where audit is structural is differentiation.
- **Configuration substrate.** `user.md` / `agent.md` as first-class authoring objects is a distinct shape no current host emphasizes.
- **The carrier layer.** Discovery and routing across MCP servers is genuinely open territory (no DNS-equivalent, no Google-equivalent for capability discovery).

This is still a real product. It's just no longer "we ship the render mechanism." It's "we ship the operator-grade host on top of standard rendering."

### 6.2 The competitive landscape is more crowded than the design document acknowledged

When the design document said "no one is building this," the accurate statement was "no one is building exactly this shape, but many are building adjacent shapes with significant resources":

- **Atlas** (OpenAI) is the most-resourced agent-native browser, with native ChatGPT integration and rapid iteration.
- **Comet** (Perplexity) has 85% task success rate and a publisher revenue-sharing model.
- **Dia** (now Atlassian) has Morning Brief, Proactive Suggestions, and is integrating with Atlassian's enterprise stack — most directly competitive for the operator wedge.
- **Mariner** (Google) has 83.5% WebVoyager, 10 parallel tasks, and the entire Google Gemini ecosystem behind it.
- **Browserbase** owns the cloud-browser infrastructure layer with $300M valuation and 1,000+ customers.
- **Multiple smaller players** (BrowserOS, Phi, Genspark, Brave Leo, Opera Neon).

The design document's framing of "incumbents are trapped by their existing businesses" is partly correct — Atlas is constrained by being downstream of ChatGPT, Mariner is constrained by Google's search business, Atlassian/Dia is constrained by its enterprise integrations. But it's also partly wrong: each of these is shipping aggressively in the adjacent space. The window is shorter than the design document estimated.

A revised estimate of the window: **9-18 months**, not 18-30. After that, one or more of these will pivot to or accidentally ship the right shape.

### 6.3 The acquisition picture is more favorable than the design document framed

Three things favor the acquisition strategy more than the design document acknowledged:

- The deal environment is on fire. Q1 2026 was the largest VC quarter ever; tech M&A is up 77%; AI deals are commanding 24x revenue multiples; Sapphire predicts a $50B+ AI acquisition this year.
- The realistic acquirer set is *broader* than the design document's list. Atlassian/Dia proved enterprise SaaS companies are buyers, not just hyperscalers. Add Adobe, Salesforce, Workday, ServiceNow, Datadog, Notion (Series F+), Anthropic itself (Anthropic's $350B valuation gives them M&A capacity).
- Sub-$1B exits are common and viable. The design document framed acquisition as a $5B+ outcome. Atlassian/TBC was $610M. That's a real outcome at a much lower bar — and it doesn't require the unicorn-scale traction the design document assumed.

This means the design document should explicitly distinguish two acquisition paths:

- **Sub-$1B path** — closer to the Atlassian/TBC model. Build a real product with credible operator traction, get acquired by an enterprise SaaS company looking to shore up its agent-era position. 18-30 months to exit. Less risky, more achievable.
- **Multi-billion path** — closer to the Wiz model. Build something that genuinely threatens an incumbent's revenue, force a defensive acquisition. 3-5 years to exit. Higher risk, higher reward, requires meaningful scale.

Both are now clearly real options. Choosing between them is a strategic decision the design document should make explicit.

---

## 7. Open gaps for deep dives

Listed in priority order:

### Priority A: Operator software case studies
The design grammar work depends on understanding what operators actually need at high information density. Bloomberg Terminal, Procore, Veeva, ServiceTitan, command-and-control systems. ~10 hours of focused research.

### Priority B: Visual design and interaction patterns
Generative UI design language, calm interface principles at high density, trust UI patterns, motion and feedback grammar. ~10 hours.

### Priority C: Carrier-layer prior art and discovery infrastructure
DNS history, search engine history, agent registry attempts, capability marketplace patterns. Especially: how the agent commerce protocols are handling discovery (or not). ~6 hours.

### Priority D: Atlassian/Browser Company integration deep dive
Most relevant comparable. What is Atlassian actually doing with Dia? What features are they prioritizing? What's working, what isn't? Read TBC blog posts, Atlassian press, third-party reviews. This tells us a lot about the operator-wedge thesis. ~4 hours.

### Priority E: MCP Apps technical depth
We need to understand exactly what MCP Apps can and cannot do, where the design surface ends and the protocol ends. Read the SEP-1865 spec carefully, build a small MCP App, test the edges. ~6 hours.

### Priority F: Identity and auth deep dive
How does Visa TAP actually work? How do Stripe SPTs actually work? What's the practical state of agent identity in production deployments? ~4 hours.

### Priority G: Acquisition comparable financial details
For the top 5 most relevant comparables, get specific numbers — final price, revenue at exit, employee count, time from founding to exit, who the acquirer's other bidders were if known. ~3 hours.

Total deep-dive scope: roughly 40-45 hours. Worth doing in priority order, with the design document updated after each priority is complete.

---

## 8. Updates required to the design document

Based on this research, the following sections of `render_surface_design_document.md` should be updated. Tracking here so they don't get lost:

1. **Section 1.3 (What is and is not changing)** — Reframe to acknowledge MCP Apps has shipped the basic render mechanism. The category is forming faster than the document assumed.

2. **Section 1.4 (Why this is winnable now)** — Update window estimate from 18-30 months to 9-18 months. Add Atlassian/Dia and the other competitors as named players.

3. **Section 2.2 (Architecture in three layers)** — Update to make MCP Apps explicit as the rendering protocol. The render surface is an MCP Apps host with operator-grade extensions.

4. **Section 3.1 (What we are building)** — Sharpen the differentiation. We are not building "a render surface" generically. We are building "an operator-grade MCP Apps host with multi-source composition, audit substrate, configuration documents, and a carrier-routing model."

5. **Section 3.4 (The acquisition path)** — Expand the buyer list to include enterprise SaaS (Atlassian-shape). Distinguish sub-$1B path from multi-billion path explicitly.

6. **Section 4 (Design tensions)** — Add: the relationship between the surface and MCP Apps as a host. Where does protocol end and host innovation begin? This is now a design tension to navigate.

7. **Section 5 (Research agenda)** — Replace with the priority list in Section 7 above.

8. **Section 6 (First experiments)** — Update Experiment A to assume MCP Apps as the rendering substrate. The first build is significantly cheaper than the design document estimated, because we're not inventing the rendering protocol.

---

*End of base-level research. Version 0.1, May 2026.*

*Next steps: Mikel reviews. We update the design document together. Then we proceed through the priority deep dives in order, updating the design document after each.*
