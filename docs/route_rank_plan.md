# RouteRank — Build Plan for Steps 5a, 5b, 5c

**Companion to:** `strategic_update.md` (especially §3.2 and §4), `research_base_levels.md`, and `research_payments_substrate.md` (5c scoping).
**Status:** Approved-with-decisions plan covering three increments.
- **5a** — substrate. **Implemented**. Tests green.
- **5b** — adversarial resistance + cold-start posture. **Implemented**, with Phase-C research-driven refinements (four-gate promotion + two-tier suspension). Tests green.
- **5c** — persistence, signing, payments scaffold. **Implemented (scaffold scope)**. Tests green at 62/62. See §6 "Shipped vs deferred" for the explicit partition between what landed in this increment and what's tracked for follow-up PRs.

**Date:** May 2026 (initial), revised after Phase-C research pass and 5c scaffold ship.

---

## 0. Why this document exists

RouteRank is the closed proprietary ranking algorithm that sits inside the carrier layer. It is the long-term moat — open protocols around it, closed intelligence in the middle. The render surface is the demand wedge; this is the engine that turns demand into revenue and incumbency.

Steps 5a–5c build that engine in three stacked increments, each shippable on its own:

- **5a — Substrate.** Replace the placeholder picker with a real multi-component score. Performance + authority + cold-start exploration via Thompson sampling.
- **5b — Adversarial resistance + cold-start posture.** Bonded exposure for new hosting agents, sybil resistance, vouching as a continuous ranking input with mutual punishment.
- **5c — Persistence, signing, payments substrate.** Receipts and vouches in SQLite, cryptographic signing, real bonded escrow via Stripe's agent-payments primitives. Online learning gradient over weights.

The structural shape comes from `strategic_update.md §4.1` (six components) and `§3.2` (cold-start mechanism). The specific primitives below were chosen after a research pass against current literature; departures from the strategic doc's first sketch are flagged.

---

## 1. Source-of-truth precedence

Per the project's standing convention:

- This document and the working conversation override.
- `strategic_update.md` is the next layer of authority.
- `render_surface_design_document.md` and `research_base_levels.md` are reference.
- `README.md` and `STRUCTURE.md` are historical (pre-pivot).

If anything in this plan conflicts with future strategic conversations, the conversation wins and this document gets revised. Do not freeze decisions here that would block honest learning from real receipt data.

---

## 2. Working norms (carried across all three steps)

- Tight, secure code. The carrier will route banking and credit-card flows eventually; treat every line as if it will.
- Don't duplicate. Edit existing structures rather than parallel ones.
- Consumer-quality discipline (`§1.5`): every feature works for someone with no operator context.
- Each step ships as a separate reviewable commit. No giant 5a+5b+5c merge.
- Research-driven primitives over hand-tuned heuristics where the literature has a clear answer.

---

## 3. Step 5a — RouteRank substrate

### 3.1 Goal

Replace `RoutingCarrier::pick_provider`'s "lowest last-success latency" heuristic with a real multi-component score per `(agent, tool)`. After 5a, every routing decision flows through a principled ranking; the picker is no longer mechanical.

### 3.2 Research-driven primitive choices

The strategic doc and the original 5a sketch specified the *shape* of the components. Research validated three substantive substitutions:

1. **Cold-start: Thompson sampling, not freshness-bonus.** Russo & Van Roy 2018 is canonical; LinkedIn, Netflix, MS Personalizer all use it in production. Sample θ ~ Beta(α, β) per ranking decision and pick argmax. Exploration is automatic — no separate freshness term.
2. **Latency: t-digest, not EWMA.** Latency is heavy-tailed; EWMA-on-mean is dominated by tail spikes (Tene's "How NOT to Measure Latency" is the canonical critique). T-digest (Dunning & Ertl 2019) gives p50/p95/p99 from one small sketch. Same v0 engineering effort, removes the "swap quantile estimator later" follow-up entirely.
3. **Authority: weighted BiRank, not degree-centrality.** HITS/BiRank converges to singular vectors of the weighted biadjacency matrix — different answers than degree once edges carry receipt-quality weights. Substantive even on the v0 trivial bipartite graph. ~50 lines (He et al. 2017, *IEEE TKDE*).

Beta priors stay at α=β=1 for the first build but with the empirical-prior swap planned for after population data exists (research consensus is α=β=1 is acceptable for v0; production systems use empirical priors).

### 3.3 Concrete deliverables

#### Receipt extension

- Add `error_kind: Option<ErrorKind>` to `Receipt` (variants: `Transport`, `JsonRpc`, `Timeout`, `Other`). Populated only on failure receipts; `None` on success.
- Add a sibling index on `ReceiptStore`: `HashMap<(AgentId, ToolName), VecDeque<usize>>` of receipt positions. Avoids O(N) rescans for per-(agent,tool) Beta updates and BiRank edge-weight assembly. Cheaper to add now than retrofit in 5b.

#### `carrier/scoring.rs` — new module

Pure functions, no state. Composes against `&ReceiptStore` and (in 5b) `&VouchStore`.

- `reliability_posterior(agent_id, tool, receipts) -> (f64, f64)` — returns `(α_post, β_post)` of the Beta posterior. Each receipt contributes `exp(-(now - ts) / half_life)` to either α (success) or β (failure). **Half-life: 24h** (research said the prompt's 1h was aggressive for reliability drift). Priors α=β=1.
- `latency_digest(agent_id, tool, receipts) -> TDigest` — t-digest assembled from successful receipts in the last 24h (the most recent of four 6h rolling buckets, merged on read). Exposes `p50()`, `p95()`. Decision below: rolling buckets, not forward-decay weights.
- `authority(receipts, vouches: Option<&VouchStore>) -> HashMap<AgentId, f64>` — weighted BiRank on the queriers↔providers bipartite graph. Edges weighted by recency-decayed success counts. Iterates to convergence (max 20 iterations, ε=1e-6). **Computed every N=50 new receipts and cached** on `RoutingCarrier`, not per-call. Per-category authority deferred to 5c+; v0 is single-graph. The `vouches` parameter is `None` in 5a; 5b layers vouch-derived edge weights through this same call site.
- `final_score(agent_id, tool, receipts, vouches: Option<&VouchStore>) -> f64`:
  ```
  θ_reliability = sample_beta(reliability_posterior(...))   // Thompson sample, per-decision
  latency_term  = 1 / (1 + latency_digest(...).p50() / 100)
  auth          = authority(...).get(agent_id)
  score         = θ_reliability × latency_term × auth
  ```

#### `pick_provider` integration

Single change in `RoutingCarrier::pick_provider`: replace the latency-only `unwrap_or(0)` heuristic with a `final_score` evaluation per ready provider, return argmax. No structural change to call sites.

#### `carrier_status` extension

Per-agent vector exposed: `(reliability_α_post, reliability_β_post, latency_p50, latency_p95, authority)`. No UI surface in 5a — pure data infrastructure for the eventual ranking-debug drawer.

### 3.4 Decisions (Mike approved)

- **Empirical priors are probably right.** v0 ships with α=β=1; once enough receipts exist to estimate the population success rate, swap to an empirical prior with ~5–10 virtual samples. Plan a post-5b calibration pass.
- **Per-decision Thompson sampling.** One Beta draw per ranking call (~nanoseconds). Stochastic but unbiased. Cached/per-second-deterministic was the alternative; rejected.
- **Rolling-bucket t-digests.** Four 6h buckets, merged on read. Simpler and more debuggable than forward-decay-weighted t-digest. Bucket rotation is a cheap O(receipts-in-bucket) operation triggered on insert.

### 3.5 Out of scope for 5a

- Vouches and adversarial resistance (5b).
- Receipt persistence (5c).
- Online learning gradient over weights (5c).
- Receipt cryptographic signing (5c).
- Per-category authority (5c+).
- UI surface for score breakdown (later polish).

### 3.6 Acceptance

- `cargo build` and `cargo test` clean.
- Two mock servers running with overlapping tools route correctly; the score field exposed in `carrier_status` shows non-trivial differences across agents under synthetic load.
- A unit test exercises Thompson sampling: with α=10, β=2 vs α=2, β=10, the first agent wins ≥95% of 1000 sampled decisions (loose statistical fence — not deterministic).
- A unit test exercises BiRank on a hand-built 4-agent graph and confirms convergence to known eigenvector.

---

## 4. Step 5b — Adversarial resistance + cold-start bonded exposure + vouching

### 4.1 Goal

Layer cold-start (`§3.2`) and adversarial resistance (`§4.1 Component 4`) onto the 5a substrate. Vouching is elevated from a cold-start gate to a continuous ranking input with **mutual punishment** — vouching for a bad actor costs the voucher's authority, making vouches load-bearing rather than free reputation.

### 4.2 Research-driven primitive choices

1. **Add SybilRank-style personalized PageRank alongside local clustering coefficient.** Pure local-clustering defenses are vulnerable to "stretched sybil" attacks (sybils that vouch for unrelated honest accounts to camouflage topology). Boshmaf et al. (Íntegro, NDSS 2015) and recent GNN-sybil papers confirm topology alone is insufficient. PPR from a trusted seed kernel catches what local clustering misses, at the same compute budget.
2. **Velocity-based detection demoted from gate to co-fire feature.** Stripe Radar's documented "naive baseline we replaced" is single-window 3σ velocity with 5–15% FPR on legitimate fast growers. Solution: dual-window acceleration ratio (24h vs 7d) that **only gates when at least one other adversarial signal also fires**.
3. **Stake calibration formula, not hardcoded amount.** Research: slash ≥ profit / detection_probability, typically 1.4–3× expected payoff. Wire the formula in code with placeholder currency; when payments wire in (5c), calibration carries forward.
4. **Vouching gated by voucher reliability.** Mike's instruction: vouching is a privilege earned through tenure + reliability. A malicious server seeking to launder another bad actor through vouches must first establish a long real track record — making the laundering attack costly enough to be uneconomic. Couples to the seed-set kernel below.

### 4.3 Trusted seed kernel (the long-term answer)

Personalized PageRank requires a seed set. The strategic doc didn't specify it; this is the design choice.

**v0:** seed kernel = the manually-onboarded hosting agents declared in `config/hosting-agents.md` (mirroring `§3.1`'s "first 50 operators get hand-built treatment" — Mikel and Dani's hand-recruited first servers ARE the trust kernel).

**Long-term:** the kernel is *self-renewing through earned promotion*. An agent automatically joins the seed kernel when:
- It has been in `Production` state for ≥ 30 days (calendar tenure, not call count — gameable otherwise),
- It has a recency-weighted reliability ≥ 0.9, and
- Its current authority is in the top decile of all production agents.

Eviction: drop below threshold → kernel membership revoked at the next recompute (every 24h). Currently-vouched-by-evicted-seed agents lose the contribution proportionally rather than instantly (smooth degradation).

This works long term because:
- It bootstraps from a small hand-built kernel without ongoing manual curation.
- Promotion is gated by *tenure* (a strictly real-time-cost signal that can't be faked by burst activity).
- The same mechanism that makes someone a vouching-eligible agent — earned tenure + reliability — also makes them a kernel candidate. Two thresholds, same metric, coherent.
- Cross-carrier federation later: peer carriers can declare their kernel as a trust-import policy decision. The kernel is local; bilateral trust is policy.

Stake-and-slash sits on top: seed-kernel members have larger bonds at risk and longer slashing windows. A kernel member caught vouching for a sybil cluster doesn't just lose authority — they lose kernel membership and a calibrated portion of their bond. The stronger the privilege, the heavier the consequence.

### 4.4 Concrete deliverables

#### `carrier/vouches.rs` — new module

```rust
pub struct Vouch {
    pub voucher_id: AgentId,
    pub vouchee_id: AgentId,
    pub ts_ms: i64,
    pub revoked_at_ms: Option<i64>,
    pub signature: Option<String>,  // 5c
}

pub struct VouchStore {
    vouches: VecDeque<Vouch>,            // capped at 10k, oldest revoked first
    by_voucher: HashMap<AgentId, Vec<usize>>,
    by_vouchee: HashMap<AgentId, Vec<usize>>,
}
```

- **1-hour revocation cooldown** per vouch — blocks "vouch widely, instant-revoke when bad" attacks.
- **Voucher gating at submission**: vouches from agents not meeting the eligibility threshold (Production state + reliability ≥ 0.8 + tenure ≥ 50 successful production calls) are silently dropped on insert. Silent rather than rejected with an error so attackers can't probe for the threshold; honest agents with insufficient tenure see no boost contribution and infer the gate exists from documentation.
- **Manual injection** via mock-server `admin_vouch { voucher, vouchee }` tool for v0 demo. Real vouching UX (declared as part of capability declarations) lands when capability declarations are spec'd.

#### `HostingAgentSpec` extension

```rust
pub struct HostingAgentSpec {
    pub id: AgentId,
    pub endpoint: String,
    pub description: Option<String>,
    pub bond_amount: u64,        // placeholder integer; real currency in 5c
    pub onboarded_at_ms: i64,    // tenure clock starts here
}

pub enum AgentLifecycle {
    Exploration { successes_so_far: u32, required: u32 },
    Production { since_ms: i64 },
    Forfeit { at_ms: i64, reason: ForfeitReason },
}
```

#### New scoring components in `carrier/scoring.rs`

- **`adversarial_resistance(agent_id, receipts, vouches) -> f64`** (0..1). Multiplicative composition:
  - `sybil_topology(agent_id, vouches)`: blend of (a) local clustering coefficient on the agent's vouch-and-receipt subgraph and (b) personalized PageRank score from the seed kernel. Either signal trips toward 0 → penalty toward 0. Both healthy → 1.
  - `velocity_anomaly(agent_id, receipts)`: dual-window acceleration ratio. Compute `r_24h / r_7d` for reliability-rise. Fire only when this ratio is >3σ above population AND at least one of (low voucher diversity, exploration-state, new account by tenure) is also flagged. Co-fire requirement is the simpler-to-reason-about version of the research's "demote to feature" advice.
  - `receipt_consistency(agent_id, receipts)`: returns 1.0 in v0. Slot reserved for self-reports vs receipts comparison once hosting agents emit self-metrics.
- **`vouch_boost(agent_id, vouches, authority) -> f64`** (0..0.3 cap):
  - For each active eligible vouch received: `weight = voucher_authority × time_decay(vouch_age, half_life=14d)`.
  - Cycle penalty: detect cycles in the vouch graph (Tarjan SCC), divide each cycle member's contribution by the cycle length.
  - Sum and cap at 0.3.
- **Mutual-punishment hook** in BiRank edge-weight assembly: when `vouchee.reliability < 0.5` (averaged over last 50 production receipts), apply `voucher_authority_penalty = α × (0.5 - vouchee_reliability)` to each active voucher's outbound authority weight. This composes automatically through the existing BiRank pass — no separate hook in `vouch_boost`. Bounded-window timing is intentional: a single bad call from the vouchee shouldn't crater the voucher.

#### Cold-start exploration in `pick_provider`

- Allocate **1–3% of matching queries** (call it 2% in v0, sample uniformly) to `Exploration`-state agents regardless of score.
- Receipts from exploration calls have `exploratory: true`; they inform exploration confidence but don't count toward production reliability or BiRank edges.
- After `successes_so_far >= required` (default required=20), agent transitions to `Production` and competes normally.
- `adversarial_resistance` trip during exploration → `state = Forfeit`, ejected from picker, bond marked forfeit.
- `exploration_calls_required: HashMap<ToolCategory, u32>` slot reserved (no categories defined yet).

#### Updated final score

```
score = θ_reliability(sample)
      × latency_term
      × authority
      × adversarial_resistance     // multiplicative — weakest-link
      × (1 + vouch_boost)          // additive bounded — lift but not rescue
```

`adversarial_resistance` multiplicative on purpose: a sybil-cluster trip torpedoes overall rank to ~0 regardless of performance numbers. `vouch_boost` additive bounded on purpose: vouches lift borderline good agents above the noise but cannot rescue a bad one (a reliability=0.1 agent caps at ~0.13 even with full vouch boost).

#### `carrier_status` extension

Per agent: `state`, `adversarial_resistance`, `vouches_received`, `vouches_made`, `is_kernel_member: bool`.

### 4.5 Decisions (Mike approved)

- **Trusted seed kernel: config-anchored at v0, self-renewing via tenure + reliability.** Long-term answer chosen; v0 bootstrap is the manually onboarded servers. The plan-doc draft included a "top-decile authority" gate as a third criterion — dropped because including it would create a cycle (kernel → PPR → authority → kernel) and the tenure + reliability gates already guard the attacks the kernel defends against. The slot is reserved for 5c if a two-pass compute warrants it.
- **Vouch-boost cap: 0.3.** Heuristic, flag as needing tuning once population data exists.
- **Vouching gated by voucher reliability + tenure.** Eligibility = Production state + reliability ≥ 0.8 + tenure ≥ 50 successful production calls. Silent drop on ineligible vouches.
- **Mutual punishment via bounded-window proportional penalty in BiRank edge weights.** Composes automatically; no separate hook.

### 4.6 Phase-C research-driven refinements (post-implementation)

The original plan-doc draft specified a fixed 20-success Exploration → Production threshold and an automatic Forfeit on adversarial-resistance trip. Phase-C research against published reputation-system promotion rules (Stripe Radar, Yelp, ad-fraud, Sourcegraph) and stake-and-slash systems (Ethereum, Cosmos, EigenLayer) pushed back on both, and the v0 implementation reflects the corrections:

**Promotion: four-gate hybrid, not fixed call-count.** Production systems uniformly use a hybrid combining minimum-count floor + statistical confidence + tenure floor + clean adversarial record. The implemented gates (`carrier/lifecycle.rs`):

1. `n_calls ≥ 50` (floor; rules out lucky streaks),
2. Bayesian credible interval `P(reliability ≥ 0.85) ≥ 0.95` with Jeffreys prior, computed via Monte Carlo from existing Beta sampling,
3. Calendar tenure ≥ 7 days (rules out burst-and-promote sybils — calendar time can't be faked),
4. `min AR observed during exploration ≥ 0.5` (clean adversarial record).

**Forfeit: two-tier, not auto-trip on continuous AR.** Research consensus: continuous score + irreversible action + limited evidence is the worst combination. Every published stake-and-slash system uses objective, attributable, verifiable triggers for hard slashes — never a continuous score alone. Two-tier is universal across Cosmos, Ethereum, EigenLayer, Stripe Radar, and Sift Score.

The implementation:
- **Tier 1 (soft, reversible).** AR < 0.3 → `Suspended` lifecycle state. Excluded from picker. Auto-resumes to Exploration with reset counters when AR ≥ 0.6 sustained for 48h continuous. Recovery timer resets if AR drops back below 0.6 mid-window.
- **Tier 2 (hard, irreversible).** Manual admin command only in v0 (`carrier_admin_forfeit`). Categorical-evidence-gated auto-Forfeit (≥1 cryptographically invalid receipt, ≥3 confirmed shared-key correlations) waits for 5c when signed receipts make those signals real.

The `Forfeit` lifecycle state still exists with the slots `SybilTopologyTrip / VelocityAnomalyTrip / ReceiptConsistencyTrip` reserved for 5c auto-trip. v0 only ever sets `ForfeitReason::Manual`.

### 4.6 Out of scope for 5b

- Receipt + vouch persistence (5c).
- Cryptographic signing of receipts and vouches (5c).
- Online learning gradient over weights (5c).
- Real bonded escrow / payments (5c).
- Cross-carrier consistency checks (later).
- UI surface for vouches / exploration state / adversarial-resistance scores (later polish).

### 4.7 Acceptance

- `cargo build` and `cargo test` clean.
- Synthetic test: a sybil ring of 5 mock agents that vouch in a cycle gets `adversarial_resistance` ~ 0 and is effectively unrouted.
- Synthetic test: an agent with reliability 0.95 and one vouch from a high-authority voucher ranks above an otherwise-equal agent with no vouches.
- Synthetic test: an agent with reliability 0.1 receiving max vouch_boost still ranks below an agent with reliability 0.9 and no vouches.
- Synthetic test: a voucher whose vouchee's reliability drops below 0.5 sees their own outbound BiRank weight degrade proportionally on next compute.

---

## 5. Step 5c — Persistence, signing, payments substrate, online learning

### 5.1 Goal

Take 5a + 5b from in-memory prototypes to durable, cryptographically verifiable, economically backed infrastructure. This is where the "open protocols, closed intelligence" architecture from `§1.3` becomes literally true — receipts are signed and portable, vouches are signed and accountable, bonds are real money, and the ranking weights themselves are learned online from outcomes.

### 5.2 What's in 5c

Five workstreams. Order is approximate; some can ship in parallel sub-PRs.

#### 5c.1 Receipt + vouch persistence (SQLite)

- SQLite database at a config-resolved path (default: `${app_data}/renderprotocol/carrier.db`).
- Tables: `receipts`, `vouches`, `agent_lifecycle`, `bonds`. Indexes that match the access patterns 5a/5b established (per-`(agent, tool)`, per-voucher, per-vouchee).
- Migration from the in-memory ring buffer is a one-shot dump on first run; no live migration concerns.
- Rotation: receipts older than 90d compress into a per-(agent, tool) summary row (`Receipt_Summary { agent, tool, count, success_count, latency_digest_blob, oldest_ts, newest_ts }`) so the working set stays bounded but historical authority computations remain accurate. Decay weights past 90d are negligible anyway.

#### 5c.2 Cryptographic signing (receipts and vouches)

- Each hosting agent gets an Ed25519 keypair on first registration; public key declared in `HostingAgentSpec`.
- Receipts are signed by **both** the carrier and the hosting agent (the carrier countersigns to attest "this call was actually routed"; the hosting agent signs to attest "this outcome is what we report"). A divergence between agent self-report and carrier-observed outcome is itself a `receipt_consistency` signal — finally giving 5b's reserved slot a real input.
- Vouches are signed by the voucher's keypair. Unsigned vouches stop counting as eligible at this point.
- Verification on every read into the scoring layer; failed verification → entry quarantined, `adversarial_resistance` penalty fires.
- Open question, defer to research pass: do we want hardware-backed key storage for the hosting agent side (TPM, secure enclave), or is software-stored sufficient for v0-of-5c? Probably software-only is fine and we revisit when high-stakes categories come online.

#### 5c.3 Payments substrate — ACP / SPT / Stripe Connect / x402 integration

Research landed in `docs/research_payments_substrate.md`. Architectural principle, restated emphatically: **use, don't build.** We are never rolling our own payment processing or escrow. Stripe and Coinbase handle the security and compliance burden; the carrier integrates against their primitives. The architecture is genuinely federation-friendly because the public interface (ACP / x402 / MPP) is open even when the default fiat implementation under the hood is Stripe SDKs.

The actual landscape is more layered than the original plan-doc draft assumed — three protocols + one product + one new primitive, none synonyms:

- **ACP** (Agentic Commerce Protocol) — open spec co-authored with OpenAI, Apache 2.0, version `2026-04-17`. Covers checkout, OAuth identity linking, order tracking, payment-token exchange. ChatGPT Instant Checkout against Etsy + Shopify is live production traffic. Composes with MCP. **This is what the public RouteRank interface speaks.**
- **Agentic Commerce Suite** — Stripe's hosted ACP implementation (Dec 2025). The fiat default for merchants who don't want to run ACP themselves.
- **SPT** (Shared Payment Tokens) — the actual new payment primitive. Scoped grant of a saved payment method: amount cap + minutes-long time window + seller identity, revocable, observable. Now fronts BNPL (Affirm, Klarna), Mastercard Agent Pay, Visa Intelligent Commerce.
- **MPP** (Machine Payments Protocol) — Stripe + Tempo, March 2026, preview API. Two settlement paths (USDC on Tempo for crypto; SPT for fiat). Sessions on-chain — agent authorizes a spending cap upfront, streams micropayments without one tx per request. Preview status; expect breaking changes through 2026.
- **x402** — Coinbase-led, Stripe added support. HTTP-402 challenge-response. Most chain-agnostic of the rails. Stripe positions x402 as one of several rails MPP can settle through.

**TAP identity correction.** The strategic doc and the original plan-doc named "TAP / Trust over Algorithm Protocol" as the identity layer. Research confirms this is a misnaming. **The real protocol is Visa's Trusted Agent Protocol (also TAP)**, with Stripe as a launch partner alongside Adyen, Checkout.com, Shopify. TAP provides three signatures: Agent Recognition Signature (HTTP header, attests Visa-approved agent), Consumer/Device Identity (signed body), Payment Container Signature (tamper-evident credential hash). Critically: **TAP only attests requesting agents.** Server identity (signed receipts in 5c) needs self-managed Ed25519 — the carrier owns this layer, not Visa, because hosting agents aren't in the consumer-payment topology TAP covers. Future doc revisions should propagate this correction.

**Workstream concrete deliverables:**

- **Bond escrow.** No turnkey Stripe primitive — `research_payments_substrate.md` is honest about this gap. Two paths:
  - *v1 (fiat):* Stripe Connect Custom + delayed payouts (≤90d) + carrier-side state machine. Real chargeback risk on card-posted bonds (~120d window). Acceptable for the demo and small-bond regime.
  - *v1+ (on-chain):* Tempo USDC escrow contract, sub-second finality, no chargeback risk. Cleaner for higher-bond categories. Wire it when bond volume justifies — until then v1 fiat is enough.
- **Carrier take rate is solved.** Stripe Connect destination charges with `application_fee_amount` is exactly the Visa-style marketplace cut. Plug this in directly; nothing custom.
- **Open question for the on-chain branch.** When MPP settlements happen on Tempo and the carrier isn't the payment terminus, can `application_fee_amount`-shape splits compose cleanly with on-chain settlement? Worth a Stripe solutions call — flagged in `research_payments_substrate.md`'s "named unknowns."
- **Public interface speaks ACP + x402 + MPP.** Federation property is preserved — peer carriers / clients can interoperate at the protocol layer even if our default fiat impl is Stripe-platform.
- **Receipt signing**: rolls forward as Ed25519 keypairs per agent (carrier-owned, not Stripe-owned). Cryptographically verifiable receipts unlock the categorical-evidence layer for Tier 2 auto-Forfeit.
- **Capability declarations** gain a `pricing` block with a price-per-call signed by the hosting agent.

**Production status snapshot** (from research doc, May 2026):
- SPT / Connect: ship-today.
- ACP: stable spec, build-against-now.
- MPP: preview, expect breaking changes through 2026.
- x402: works but ~50% of public volume is reportedly synthetic (bot/test traffic, not organic).

#### 5c.4 Online learning over weights

- The multiplicative final score has implicit equal weights across components. Real production systems learn these weights from outcomes.
- Workstream: a slow gradient descent (per `§4.1 Component 6`) over the multiplicative weights, optimized for a delayed outcome signal (user-agent feedback, transaction completion, or rating). Per-category weight profiles develop over time.
- Constraints: weights must remain interpretable (no neural net layer in the middle), and the loss function must avoid creating a perverse incentive (e.g. optimizing for "agent doesn't return errors" by routing only to agents that swallow failures silently).
- Specific algorithm choice deferred until 5c is being built — likely a contextual-bandit framing with the categorical context being the tool category.

#### 5c.5 Cross-carrier consistency checks

- Per `§4.1 Component 4`'s last sub-bullet. Once federation lands (a peer carrier exposes its receipt summary stream over an open protocol), compare the same agent's reputation across carriers. Large divergences are a signal.
- v0 of 5c probably ships with the slot wired but no peer carrier; gets exercised when the second carrier comes online.

### 5.3 Decisions to flag for 5c

- **Build vs integrate is decided: integrate.** Use Stripe / Coinbase primitives. Never roll our own payment processing or escrow. Stripe Connect destination charges for take-rate; Stripe Connect Custom + delayed payouts for v1 fiat bonds; Tempo USDC escrow for v1+ on-chain bonds; ACP / x402 / MPP at the public-interface layer to preserve federation.
- **Server identity stays carrier-owned.** Ed25519 keypairs per hosting agent, the carrier-side signing path. Visa TAP attests requesting agents only — not the right layer for hosting-agent identity.
- **Hardware-backed keys for hosting agents.** Likely no for v0 of 5c. Revisit for high-stakes categories.
- **Online-learning algorithm.** Contextual bandit vs explicit gradient descent. Decide during 5c.
- **Receipt rotation threshold.** 90d is a guess; calibrate against actual storage growth and decay-weight-floor math.
- **Federation protocol shape.** Out of scope until at least one peer carrier exists; reserve the slot in the data model.
- **Open question (ask Stripe solutions).** Whether `application_fee_amount`-style splits compose cleanly with on-chain MPP settlements where the carrier isn't the payment terminus. Flagged in `research_payments_substrate.md`.

### 5.4 Out of scope for 5c (and beyond)

- UI surface for ranking-debug drawer (later polish, after rankings stabilize on real data).
- Multi-tenant / multi-user-agent carrier (post-1.0).
- Specialty vertical carriers (post-1.0).
- Premium placement mechanism (`§2.2`) (post-1.0; needs careful design to not corrupt ranking).
- Aggregated data products (`§2.2`) (post-1.0; privacy architecture has to be airtight first).

---

## 6. 5c shipped vs deferred — explicit tracking

5c shipped as a **scaffold scope** PR, not a full integration. The structural plumbing for persistence, signing, and payments is in place; specific integrations against external services are tracked here as deferrals so nothing slips into "we forgot we deferred this" territory.

### 6.1 Shipped in this 5c increment

**Persistence (5c.1)** — fully shipped.
- `carrier/storage.rs` wraps SQLite (rusqlite, bundled). WAL journal, schema_version table, on-open migration. Tables: `receipts`, `receipt_summaries`, `vouches`, `agent_keys`. Data dir resolved via `config_watcher::resolve_data_dir()` (env-overridable).
- Write-through from `RoutingCarrier`: every receipt insert and vouch insert/revoke mirrors to the `Storage` synchronously. In-memory stores remain the hot read path.
- `RoutingCarrier::with_storage(...)` hydrates the in-memory stores on boot — receipts and vouches survive restart with signature verification on load (failed verifications are quarantined and counted).
- Receipt rotation: `Storage::rotate_old_receipts(cutoff_ms)` + `RoutingCarrier::rotate_old_receipts(...)` roll receipts older than `cutoff_ms` into per-(agent, tool) summary rows and delete the originals. End-to-end test asserts the round-trip.
- End-to-end test (`persistence_round_trip_via_routing_carrier`) verifies receipts + vouches survive a `KeyStore` reopen with signatures still verifying.

**Signing (5c.2)** — shipped at v0 single-party scope (Q1.b).
- `carrier/keys.rs` — Ed25519 keypair per agent, persisted to `agent_keys`. Carrier signs both sides of every receipt; voucher signs every vouch. Verification on load; failure quarantines.
- Signed payload is a deterministic byte serialization: `agent_id || tool || success || latency_ms || ts_ms` for receipts; `voucher_id || vouchee_id || ts_ms` for vouches.
- `KeyStore::new` warms the in-memory cache from all persisted keys so verification works without per-agent lazy-load on the hot path.

**Payments scaffold (5c.3 partial)** — shipped, real integration deferred (Q2 stub-with-real-when-configured).
- `carrier/payments::PaymentBackend` trait — `escrow_bond`, `release_bond`, `forfeit_bond`, `settle_take_rate`. Every consumer routes through the trait.
- `StubBackend` (default) — logs every operation, returns synthetic IDs, records history for tests.
- `StripeBackend` skeleton — method signatures, `unimplemented!`-equivalent bodies, comment-documented as "real impl in follow-up PR."
- `HostingAgentSpec` gains `price_per_call_cents`, `carrier_take_rate_bps`, `merchant_account_id`. Parsed from `config/hosting-agents.md`. Defaults: free routing, 1.00% take rate.
- `acp_checkout` Tauri command — minimal ACP-shape inbound handler. Translates an ACP checkout request to a routed tool call, settles take-rate via the configured backend, returns ACP-shape response.
- `RoutingCarrier::admin_forfeit` invokes `payments.forfeit_bond` on transition (synthetic bond id; real bond-tracking arrives with the Stripe wiring follow-up).

**Slot reservations (5c.4 + 5c.5)** — slot-only.
- `scoring::WeightProfile` struct (default = all weights 1.0). Unused by `score()` for now; the multiplicative final preserves existing semantics. Gradient learning lands when an outcome-signal pipe from the render surface exists.
- `registry::PeerCarrierSpec` data shape. Empty in v0; activates when at least one peer carrier exists for cross-carrier consistency checks.

### 6.2 Deferred to follow-up PRs (explicit tracker)

Each deferred item names: what's required, why deferred, and what unblocks the follow-up.

**A. Real Stripe Connect Custom integration for fiat bond escrow.**
- *What:* Replace `StripeBackend`'s `unimplemented!` bodies with real calls to Stripe's REST API (or `async-stripe` once a Rust 1.88+ baseline is acceptable). Connect Custom accounts for hosting agents; PaymentIntents with `transfer_data.destination`; delayed-payout schedules ≤90d for bond holding; reversals for forfeits.
- *Why deferred:* The trait surface is more important than the integration in v0 — getting the abstraction right unblocks any follow-up. Real Stripe wiring needs production keys + a Connect-eligible business account + chargeback handling that's its own scope.
- *Unblocks:* Stripe test-mode keys configured, Connect Custom enabled on the platform account, decision on Rust 1.88 baseline.

**B. Stripe Connect destination charges with `application_fee_amount` for take-rate.**
- *What:* The `acp_checkout` path computes the carrier cut and passes it to `payments.settle_take_rate`; the stub logs but doesn't pay anyone. Real impl creates a PaymentIntent on the platform account with `application_fee_amount = carrier_cut`, `transfer_data.destination = merchant_account_id`. Stripe handles the split.
- *Why deferred:* Same blocker as (A) — needs real Stripe keys + Connect setup. Trait surface is correct.
- *Unblocks:* Same as (A).

**C. x402 challenge-response middleware.**
- *What:* HTTP-402 challenge handling so the carrier can serve agent-paid endpoints in the x402 protocol shape. Coinbase-led, more chain-agnostic than MPP.
- *Why deferred:* Needs a chain wallet; ~50% of public x402 volume is reportedly synthetic per the research doc — production readiness signal isn't there yet for v0.
- *Unblocks:* Real x402 use case + carrier-side wallet.

**D. MPP session-token handling.**
- *What:* Stripe + Tempo's session-on-chain protocol. Agent authorizes spending cap once, streams micropayments without one tx per request.
- *Why deferred:* MPP API is in preview status (`2026-03-04.preview`) with breaking changes expected through 2026.
- *Unblocks:* MPP API stabilization. Watch-and-wait until Stripe declares it stable.

**E. TAP signature verification on inbound ACP requests.**
- *What:* Visa Trusted Agent Protocol — verify the three TAP signatures (Agent Recognition, Consumer/Device Identity, Payment Container) on every inbound ACP request. v0 `acp_checkout` accepts `payment_token` but doesn't validate.
- *Why deferred:* TAP is requesting-agent identity; v0 demo doesn't have TAP-emitting clients to test against. Adding verification before any client emits the signatures is dead code.
- *Unblocks:* At least one TAP-emitting client (real ChatGPT Instant Checkout, real Visa Intelligent Commerce, etc.) integrating against our carrier.

**F. Tempo USDC on-chain escrow for the v1+ on-chain bond branch.**
- *What:* For higher-bond categories, post bonds on-chain via a Tempo escrow contract instead of through Stripe Connect's delayed-payout window. Cleaner durability (no chargeback risk).
- *Why deferred:* No on-chain volume in v0 demo. Justified once bond volume justifies the complexity.
- *Unblocks:* Real high-bond category needing chargeback-immune escrow.

**G. Online-learning gradient over `WeightProfile`.**
- *What:* Slow gradient updates to `WeightProfile` based on delayed user-satisfaction outcomes. Per-category weight profiles develop over time.
- *Why deferred:* No outcome-signal pipe exists yet. The render surface needs to emit user-satisfaction events that the carrier ingests; that's a separate cross-cutting workstream.
- *Unblocks:* Render-surface satisfaction signal pipe; non-trivial traffic volume to learn against.

**H. Cross-carrier consistency checks (federation hook).**
- *What:* Compare the same agent's receipt summaries across peer carriers; large divergences feed `receipt_consistency`.
- *Why deferred:* No peer carrier exists.
- *Unblocks:* At least one peer carrier connected via the federation API (when that API is specced).

**I. Real bond-id tracking per agent.**
- *What:* `HostingAgent` carries a `bond_id: Option<BondId>` populated when escrow is created on Exploration entry; consumed on Production graduation (release) or Forfeit (forfeit). v0 admin_forfeit uses a synthetic bond id.
- *Why deferred:* Coupled with (A) — there's no real bond to track until real escrow exists. Adding the field now would create dead state.
- *Unblocks:* (A).

**J. Hardware-backed keys for hosting agents.**
- *What:* TPM / secure enclave for Ed25519 private keys instead of SQLite-stored bytes.
- *Why deferred:* v0 single-party signing keeps the entire keystore software-side; no hardware boundary to defend yet. Revisit when high-stakes categories warrant the operational complexity.
- *Unblocks:* High-stakes category requirement (compliance, regulated finance, etc.).

**K. MCP receipt-signing extension (real dual-signing).**
- *What:* Carrier signs its side; hosting agents sign their side independently with their own keys. Divergence between self-report and observed outcome activates `receipt_consistency`.
- *Why deferred:* Requires an MCP spec extension that real third-party servers adopt. Half-baked spec is worse than waiting.
- *Unblocks:* Spec proposal accepted upstream + at least one third-party server adopting.

### 6.3 Build order recap (final)

```
5a — substrate:          Receipt.error_kind, sibling index, scoring.rs
                         (reliability + latency_digest + authority),
                         pick_provider rewrite, carrier_status extension.
                         Decisions baked: empirical-priors-later, per-decision
                         Thompson sampling, rolling-bucket t-digests.

5b — adversarial + cold: vouches.rs, HostingAgentSpec extension,
                         AgentLifecycle (Exploration / Production /
                         Suspended / Forfeit), scoring extensions,
                         four-gate promotion, two-tier suspension,
                         seed kernel, carrier_status extension.

5c — durability + $:     SQLite persistence (full), receipt rotation,
                         Ed25519 signing both sides (single-party v0),
                         PaymentBackend trait + StubBackend (StripeBackend
                         skeleton), HostingAgentSpec.pricing,
                         acp_checkout Tauri command, WeightProfile slot,
                         PeerCarrierSpec slot.
                         11 deferred items tracked in §6.2.
```

5a's scoring substrate is what 5b extends; 5b's vouch and lifecycle types are what 5c persists and signs. No retrofitting.

---

## 7. The thing this is

This is the search algorithm. It is the moat. It is the "Google" half of "Chrome + Google for the agent-native internet." The render surface is what gets the user in the door; this is what makes them stay, and it's what monetizes the network.

Get this right matters more than ship it fast. Every decision above was made with that asymmetry in mind: research the literature, choose the standard primitive, document the calibration assumption, leave the slot for the next layer. The build is fast because the *thinking* was slow.

---

*End of build plan. Version 0.2, May 2026. Updated post-5c-scaffold ship.*
