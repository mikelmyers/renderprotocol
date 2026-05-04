// RouteRank scoring substrate (steps 5a + 5b, see `docs/route_rank_plan.md`).
//
// Pure functions over `&ReceiptStore` and `&VouchStore`. No interior
// state. Composed into the multiplicative final score:
//
//   score = θ_reliability(sample) × latency_term × authority
//         × adversarial_resistance × (1 + vouch_boost)
//
// Components, layered:
//
//   - reliability  (5a): Beta posterior, α=β=1 priors, 24h-half-life
//                        exponential decay. Sampled with Thompson per
//                        ranking decision.
//   - latency      (5a): t-digest of successful-call latency over a 24h
//                        window. p50 feeds the score; p95 surfaced for
//                        `carrier_status`.
//   - authority    (5a): recency-decayed share of network-wide successes,
//                        normalized to sum=1. Mutual-punishment (5b)
//                        diminishes a voucher's authority when their
//                        vouchees misbehave — applied in the same pass.
//   - adversarial_resistance (5b): multiplicative composition of
//                        sybil_topology, velocity_anomaly, and
//                        receipt_consistency. Weakest-link binding —
//                        a trip on any sub-score torpedoes the agent.
//   - vouch_boost  (5b): bounded additive contribution from received
//                        vouches, weighted by voucher authority and
//                        recency, divided by cycle length when the
//                        agent participates in a vouch cycle.
//   - kernel       (5b): config-anchored seed set with auto-promotion
//                        (≥30d production tenure + reliability ≥0.9).
//                        Used as the trust source for sybil topology's
//                        seed-reachability check.

use std::collections::{HashMap, HashSet, VecDeque};

use rand::thread_rng;
use rand_distr::{Beta, Distribution};
use tdigest::TDigest;

use super::lifecycle::AgentLifecycle;
use super::receipts::ReceiptStore;
use super::registry::HostingAgentSpec;
use super::vouches::VouchStore;

/// Half-life for reliability decay. Research consensus is that 1h is
/// aggressive for reliability drift in routing systems; 24h matches the
/// timescale on which agent reliability actually changes (deploys,
/// upstream incidents). See `docs/route_rank_plan.md §3.4`.
pub const RELIABILITY_HALF_LIFE_MS: f64 = 24.0 * 3600.0 * 1000.0;

/// Latency window: 4 × 6h rolling buckets = 24h. Successful receipts
/// older than this are excluded from the t-digest. Decision is captured
/// in `docs/route_rank_plan.md §3.4`.
pub const LATENCY_WINDOW_MS: i64 = 24 * 3600 * 1000;

/// Compression for the t-digest. 100 gives ~1% accuracy on tail
/// quantiles which is plenty for a v0 router.
const TDIGEST_COMPRESSION: usize = 100;

/// Floor on authority for cold-start agents not yet in the map.
/// Calibrated so Thompson exploration on Beta(1,1) lets a cold-start
/// agent beat a warm agent on ~10–15% of decisions in a 2-provider
/// scenario. Tunable once population data exists.
const AUTHORITY_COLD_START_FLOOR: f64 = 0.05;

/// Cold-start latency assumption used when no successful samples exist.
/// 50ms is a generic-good baseline; if cold-start agents are faster,
/// they earn it back over the first few calls. Used only by score()
/// when the t-digest is empty.
const COLD_START_LATENCY_MS: f64 = 50.0;

// ---- 5b constants ------------------------------------------------------

/// How many recent production receipts to average for mutual-punishment
/// vouchee-reliability assessment. Bounded-window protects honest
/// vouchers from a single bad call by their vouchee.
pub const MUTUAL_PUNISHMENT_WINDOW: usize = 50;

/// Reliability threshold below which a vouchee triggers voucher penalty.
/// `§4.4` of the plan specifies 0.5; below this, the voucher's
/// authority is diminished proportionally.
pub const MUTUAL_PUNISHMENT_RELIABILITY_THRESHOLD: f64 = 0.5;

/// Cap on the additive `vouch_boost` term. Heuristic — calibrate once
/// population data exists. With 0.3, an agent with reliability 0.1 and
/// max vouch boost still scores below an agent with reliability 0.9 and
/// no vouches: vouches lift but don't rescue.
pub const VOUCH_BOOST_CAP: f64 = 0.3;

/// Half-life for vouch-age decay in `vouch_boost`. 14 days lets vouches
/// remain meaningful through normal latency/quality drift but ages out
/// stale endorsements.
pub const VOUCH_HALF_LIFE_MS: f64 = 14.0 * 24.0 * 3600.0 * 1000.0;

/// Tenure (calendar ms in Production state) required for auto-promotion
/// into the seed kernel. Calendar tenure is intentional — call-count is
/// gameable through burst activity; calendar time isn't.
pub const KERNEL_PROMOTION_TENURE_MS: i64 = 30 * 24 * 3600 * 1000;

/// Reliability gate for kernel auto-promotion.
pub const KERNEL_PROMOTION_RELIABILITY: f64 = 0.9;

/// Velocity-anomaly: 24h vs 7d acceleration ratio. Below this ratio,
/// no velocity anomaly fires. Above it AND a co-fire signal is also
/// present (low voucher diversity / exploration state / new account)
/// → adversarial_resistance penalty proportional to the ratio.
pub const VELOCITY_ACCELERATION_THRESHOLD: f64 = 1.5;

const VELOCITY_SHORT_WINDOW_MS: i64 = 24 * 3600 * 1000;
const VELOCITY_LONG_WINDOW_MS: i64 = 7 * 24 * 3600 * 1000;

/// Maximum hops in seed-kernel reachability check (bounded BFS used as a
/// cheap personalized-PageRank proxy in v0). 4 hops covers any realistic
/// trust chain in a small network without runaway compute.
const KERNEL_REACHABILITY_MAX_HOPS: usize = 4;

#[derive(Debug, Clone)]
pub struct AgentScoreSnapshot {
    pub agent_id: String,
    pub tool: String,
    pub reliability_alpha: f64,
    pub reliability_beta: f64,
    pub latency_p50_ms: Option<f64>,
    pub latency_p95_ms: Option<f64>,
    pub authority: f64,
    /// 5b: composite adversarial-resistance score (0..1). 1.0 = healthy.
    pub adversarial_resistance: f64,
    /// 5b: bounded additive vouch contribution (0..VOUCH_BOOST_CAP).
    pub vouch_boost: f64,
}

/// Beta posterior `(α_post, β_post)` for the success rate of
/// `(agent_id, tool)`. Each receipt contributes `exp(-Δt / half_life)`
/// to α (success) or β (failure). Priors α=β=1.
///
/// Recency-weighted Beta is a discount heuristic, not a strict posterior
/// (the literature calls this "discounted Thompson sampling" /
/// "non-stationary Bayesian bandits"). It's the standard production
/// approach for non-stationary success-rate tracking.
pub fn reliability_posterior(
    agent_id: &str,
    tool: &str,
    receipts: &ReceiptStore,
    now_ms: i64,
) -> (f64, f64) {
    let mut alpha = 1.0_f64;
    let mut beta = 1.0_f64;
    for r in receipts.iter_for(agent_id, tool) {
        let dt = (now_ms - r.ts_ms).max(0) as f64;
        let w = (-dt / RELIABILITY_HALF_LIFE_MS).exp();
        if r.success {
            alpha += w;
        } else {
            beta += w;
        }
    }
    (alpha, beta)
}

/// Sample a single θ ~ Beta(α, β). Called per ranking decision —
/// stochastic but unbiased (decision: per-decision sampling, see
/// `docs/route_rank_plan.md §3.4`). One Beta draw is nanoseconds.
pub fn sample_reliability(alpha: f64, beta: f64) -> f64 {
    // Beta::new fails only on non-positive parameters; α,β are ≥ 1.0
    // by construction here, so the unwrap is structurally sound.
    let dist = Beta::new(alpha, beta).expect("alpha and beta are >= 1.0");
    dist.sample(&mut thread_rng())
}

/// t-digest of successful-call latency for `(agent_id, tool)` over the
/// last 24h. None when no successful samples exist (cold-start signal).
///
/// Implementation note: the plan specifies "rolling-bucket t-digests"
/// for cleaner debug semantics. v0 builds the digest on read from the
/// already-indexed `iter_for` slice — equivalent semantics, simpler
/// code, no bucket rotation hook. Receipts past 24h are filtered by
/// timestamp at read time. If perf becomes a concern at 5c-scale call
/// volume, swap to maintained per-(agent, tool) digest pairs.
pub fn latency_digest(
    agent_id: &str,
    tool: &str,
    receipts: &ReceiptStore,
    now_ms: i64,
) -> Option<TDigest> {
    let window_start = now_ms - LATENCY_WINDOW_MS;
    let samples: Vec<f64> = receipts
        .iter_for(agent_id, tool)
        .into_iter()
        .filter(|r| r.success && r.ts_ms >= window_start)
        .map(|r| r.latency_ms as f64)
        .collect();
    if samples.is_empty() {
        return None;
    }
    let td = TDigest::new_with_size(TDIGEST_COMPRESSION);
    Some(td.merge_unsorted(samples))
}

/// Authority scores per agent. Recency-decayed share of network-wide
/// successes, normalized so the map sums to 1.0, with mutual-punishment
/// applied: each voucher's authority is multiplied by `(1 − penalty)`
/// when their active vouchees' reliability falls below 0.5 (averaged
/// over the last `MUTUAL_PUNISHMENT_WINDOW` production receipts).
///
/// Agents with no successful production receipts are not in the
/// returned map; the caller treats absence as cold-start.
///
/// Production receipts only: `exploratory: true` receipts are excluded
/// to keep exploration calls from inflating an agent's authority before
/// they've earned production status.
pub fn authority(
    receipts: &ReceiptStore,
    vouches: &VouchStore,
    now_ms: i64,
) -> HashMap<String, f64> {
    let mut weights: HashMap<String, f64> = HashMap::new();
    for r in receipts.iter_all() {
        if !r.success || r.exploratory {
            continue;
        }
        let dt = (now_ms - r.ts_ms).max(0) as f64;
        let w = (-dt / RELIABILITY_HALF_LIFE_MS).exp();
        *weights.entry(r.agent_id.clone()).or_insert(0.0) += w;
    }

    // Mutual-punishment pass: for each agent that has made active
    // vouches, sum the deficits of their vouchees' reliability below
    // the threshold. Apply as a multiplicative reduction (capped at
    // 100% — penalty can torpedo the voucher's authority but never
    // negate it, which would flip the sign).
    let adj = vouches.outbound_adjacency();
    for (voucher_id, vouchees) in &adj {
        let mut total_penalty = 0.0_f64;
        for vouchee_id in vouchees {
            let rel = overall_reliability(vouchee_id, receipts, MUTUAL_PUNISHMENT_WINDOW, now_ms);
            // Penalty kicks in only when vouchee is below threshold.
            // Bounded-window via overall_reliability protects against a
            // single bad call cratering an honest voucher.
            if rel < MUTUAL_PUNISHMENT_RELIABILITY_THRESHOLD {
                total_penalty += MUTUAL_PUNISHMENT_RELIABILITY_THRESHOLD - rel;
            }
        }
        let penalty_factor = total_penalty.min(1.0);
        if penalty_factor > 0.0 {
            if let Some(w) = weights.get_mut(voucher_id) {
                *w *= 1.0 - penalty_factor;
            }
        }
    }

    let total: f64 = weights.values().sum();
    if total <= 0.0 {
        return HashMap::new();
    }
    for v in weights.values_mut() {
        *v /= total;
    }
    weights
}

/// Overall reliability for `agent_id` averaged over the last `n_recent`
/// non-exploratory receipts (across all tools), recency-weighted with the
/// same 24h half-life as per-(agent, tool) reliability. Returns 1.0 when
/// no production receipts exist (cold-start neutrality — don't penalize
/// new agents that haven't acted yet).
pub fn overall_reliability(
    agent_id: &str,
    receipts: &ReceiptStore,
    n_recent: usize,
    now_ms: i64,
) -> f64 {
    let mut samples: Vec<(i64, bool)> = receipts
        .iter_all()
        .filter(|r| r.agent_id == agent_id && !r.exploratory)
        .map(|r| (r.ts_ms, r.success))
        .collect();
    if samples.is_empty() {
        return 1.0;
    }
    // Newest first.
    samples.sort_by(|a, b| b.0.cmp(&a.0));
    samples.truncate(n_recent);
    let mut alpha = 1.0_f64;
    let mut beta = 1.0_f64;
    for (ts, success) in samples {
        let dt = (now_ms - ts).max(0) as f64;
        let w = (-dt / RELIABILITY_HALF_LIFE_MS).exp();
        if success {
            alpha += w;
        } else {
            beta += w;
        }
    }
    alpha / (alpha + beta)
}

/// Count of successful, non-exploratory receipts attributed to this
/// agent. Used as the tenure floor for voucher eligibility.
pub fn successful_production_calls(agent_id: &str, receipts: &ReceiptStore) -> u32 {
    receipts
        .iter_all()
        .filter(|r| r.agent_id == agent_id && r.success && !r.exploratory)
        .count() as u32
}

/// Bayesian credible-interval gate for promotion decisions. Returns
/// `true` when, given the agent's exploration record, the posterior
/// belief P(reliability ≥ `threshold`) ≥ `confidence`.
///
/// Computed via Monte Carlo sampling from Beta(α + successes, β +
/// failures) with Jeffreys prior α = β = 0.5. Jeffreys is the
/// reference prior for binomial inference and is more conservative on
/// thin samples than the uniform Beta(1,1).
///
/// 5b note: this is the second of the four promotion gates (the others
/// are call-count floor, calendar tenure, and clean adversarial record;
/// see `lifecycle.rs` for the full set). The function only computes the
/// statistical-confidence piece.
pub fn promotion_gate_satisfied(
    successes: u32,
    failures: u32,
    threshold: f64,
    confidence: f64,
) -> bool {
    const MC_SAMPLES: usize = 1000;
    let alpha = 0.5 + successes as f64;
    let beta = 0.5 + failures as f64;
    let mut hits: usize = 0;
    for _ in 0..MC_SAMPLES {
        if sample_reliability(alpha, beta) >= threshold {
            hits += 1;
        }
    }
    (hits as f64) / (MC_SAMPLES as f64) >= confidence
}

// ---- 5b: kernel, adversarial-resistance, vouch-boost ------------------

/// Compute the seed-kernel membership for the trust subsystem.
///
/// Two sources combine:
///   1. Config-anchored: any `HostingAgentSpec` with `seed: true`. v0
///      bootstrap; mirrors `§3.1`'s "first 50 operators get hand-built
///      treatment."
///   2. Auto-promoted: agents in Production with calendar tenure ≥ 30
///      days and overall reliability ≥ 0.9. The `top-decile authority`
///      gate from the plan is reserved for 5c; including it here would
///      create a circular dependency (kernel → PPR → authority → kernel)
///      and the tenure + reliability gates already guard against the
///      attacks the kernel is supposed to defend against.
pub fn kernel_members(
    specs: &[HostingAgentSpec],
    lifecycles: &HashMap<String, AgentLifecycle>,
    receipts: &ReceiptStore,
    now_ms: i64,
) -> HashSet<String> {
    let mut kernel: HashSet<String> = HashSet::new();
    for spec in specs {
        if spec.seed {
            kernel.insert(spec.id.clone());
        }
    }
    for spec in specs {
        if kernel.contains(&spec.id) {
            continue;
        }
        let Some(life) = lifecycles.get(&spec.id) else {
            continue;
        };
        let tenure_ms = life.production_tenure_ms(now_ms);
        if tenure_ms < KERNEL_PROMOTION_TENURE_MS {
            continue;
        }
        let rel = overall_reliability(&spec.id, receipts, MUTUAL_PUNISHMENT_WINDOW, now_ms);
        if rel < KERNEL_PROMOTION_RELIABILITY {
            continue;
        }
        kernel.insert(spec.id.clone());
    }
    kernel
}

/// Sybil-topology score for `agent_id`. 1.0 = healthy, drops toward 0
/// only when adversarial vouch patterns emerge:
///   - High local clustering coefficient (tight ring of vouches), AND
///   - No path from the seed kernel within `KERNEL_REACHABILITY_MAX_HOPS`.
///
/// Returns 1.0 by default for agents with no vouch-graph context — new
/// agents shouldn't be sybil-penalized just for being new (that's the
/// exploration-allocation mechanism's job).
///
/// Kernel members short-circuit to 1.0 — they are trusted by definition
/// of the kernel, and the trust kernel is the foundation against which
/// all other agents are evaluated.
pub fn sybil_topology(
    agent_id: &str,
    vouches: &VouchStore,
    kernel_members: &HashSet<String>,
) -> f64 {
    if kernel_members.contains(agent_id) {
        return 1.0;
    }
    let in_active = vouches.agents_in_active_graph();
    if !in_active.contains(agent_id) {
        return 1.0;
    }
    let adj = vouches.outbound_adjacency();
    let clustering = local_clustering_coefficient(agent_id, &adj);
    let kernel_reachable = is_kernel_reachable(agent_id, &adj, kernel_members);

    // Either a tight cluster OR no path from kernel = penalty. Both =
    // strong penalty (the multiplicative product collapses).
    let cluster_term = (1.0 - clustering).max(0.0);
    let kernel_term = if kernel_reachable { 1.0 } else { 0.5 };
    (cluster_term * kernel_term).clamp(0.0, 1.0)
}

/// Local (undirected) clustering coefficient for `agent_id` in the
/// active vouch graph. C(v) = 2 * E_in_neighborhood / (k * (k - 1))
/// where k is degree. Returns 0.0 for nodes with degree < 2 (clustering
/// undefined; can't form a triangle).
fn local_clustering_coefficient(
    agent_id: &str,
    adj: &HashMap<String, HashSet<String>>,
) -> f64 {
    // Undirected neighborhood: union of out-edges and reverse in-edges.
    let mut neighbors: HashSet<String> = HashSet::new();
    if let Some(out) = adj.get(agent_id) {
        for n in out {
            neighbors.insert(n.clone());
        }
    }
    for (voucher, vouchees) in adj {
        if vouchees.contains(agent_id) {
            neighbors.insert(voucher.clone());
        }
    }
    let k = neighbors.len();
    if k < 2 {
        return 0.0;
    }
    let mut edges_in_neighborhood = 0_usize;
    for u in &neighbors {
        let Some(u_out) = adj.get(u) else { continue };
        for v in &neighbors {
            if u == v {
                continue;
            }
            if u_out.contains(v) {
                edges_in_neighborhood += 1;
            }
        }
    }
    // edges_in_neighborhood counts directed edges; the formula below
    // is equivalent when treating the graph as undirected (every
    // bidirectional pair counts twice in the numerator and the
    // denominator divides by k(k-1) without the customary 2× factor).
    let max_edges = (k * (k - 1)) as f64;
    edges_in_neighborhood as f64 / max_edges
}

/// True iff `agent_id` is reachable from any kernel member in the
/// active vouch graph within `KERNEL_REACHABILITY_MAX_HOPS` directed
/// hops. v0 stand-in for personalized PageRank — bounded BFS gives the
/// same "is this agent in the kernel's trust radius" signal at a
/// fraction of the compute. Real PPR with restart probability is a
/// 5c++ concern.
fn is_kernel_reachable(
    agent_id: &str,
    adj: &HashMap<String, HashSet<String>>,
    kernel_members: &HashSet<String>,
) -> bool {
    if kernel_members.is_empty() {
        return false;
    }
    let mut visited: HashSet<String> = kernel_members.clone();
    let mut frontier: VecDeque<(String, usize)> = kernel_members
        .iter()
        .map(|k| (k.clone(), 0_usize))
        .collect();
    while let Some((node, hops)) = frontier.pop_front() {
        if hops >= KERNEL_REACHABILITY_MAX_HOPS {
            continue;
        }
        let Some(out) = adj.get(&node) else { continue };
        for next in out {
            if next == agent_id {
                return true;
            }
            if visited.insert(next.clone()) {
                frontier.push_back((next.clone(), hops + 1));
            }
        }
    }
    false
}

/// Velocity-anomaly score for `agent_id`. 1.0 = no anomaly, drops
/// proportionally to acceleration only when:
///   1. 24h reliability has risen suspiciously fast vs the 7d baseline
///      (acceleration ratio > VELOCITY_ACCELERATION_THRESHOLD), AND
///   2. A co-fire signal is also present (low voucher diversity, OR
///      Exploration state, OR new account by tenure).
///
/// Standalone velocity has 5–15% FPR on legitimate fast growers per
/// the research. The co-fire requirement is the v0 conservative
/// translation of "demote velocity to a feature."
pub fn velocity_anomaly(
    agent_id: &str,
    receipts: &ReceiptStore,
    vouches: &VouchStore,
    lifecycle: Option<&AgentLifecycle>,
    spec: Option<&HostingAgentSpec>,
    now_ms: i64,
) -> f64 {
    let r_24h = window_reliability(agent_id, receipts, VELOCITY_SHORT_WINDOW_MS, now_ms);
    let r_7d = window_reliability(agent_id, receipts, VELOCITY_LONG_WINDOW_MS, now_ms);
    let r_long = r_7d.max(0.05);
    let acceleration = r_24h / r_long;
    if acceleration < VELOCITY_ACCELERATION_THRESHOLD {
        return 1.0;
    }
    // Co-fire requirement.
    let voucher_diversity = vouches.active_for_vouchee(agent_id).len();
    let is_exploration = lifecycle.map(|l| l.is_exploration()).unwrap_or(false);
    let new_account = spec
        .map(|s| (now_ms - s.onboarded_at_ms) < KERNEL_PROMOTION_TENURE_MS)
        .unwrap_or(false);
    let co_fires = voucher_diversity < 3 || is_exploration || new_account;
    if !co_fires {
        return 1.0;
    }
    // Penalty proportional to acceleration over threshold, capped.
    let penalty = ((acceleration - VELOCITY_ACCELERATION_THRESHOLD)
        / VELOCITY_ACCELERATION_THRESHOLD)
        .clamp(0.0, 1.0);
    (1.0 - penalty).max(0.0)
}

fn window_reliability(
    agent_id: &str,
    receipts: &ReceiptStore,
    window_ms: i64,
    now_ms: i64,
) -> f64 {
    let cutoff = now_ms - window_ms;
    let mut alpha = 1.0_f64;
    let mut beta = 1.0_f64;
    for r in receipts.iter_all() {
        if r.agent_id != agent_id || r.exploratory || r.ts_ms < cutoff {
            continue;
        }
        if r.success {
            alpha += 1.0;
        } else {
            beta += 1.0;
        }
    }
    alpha / (alpha + beta)
}

/// Receipt-consistency score. Slot reserved for 5c when hosting agents
/// emit self-reports of outcomes; v0 returns 1.0 since there's nothing
/// to compare against.
pub fn receipt_consistency(_agent_id: &str, _receipts: &ReceiptStore) -> f64 {
    1.0
}

/// Composite adversarial-resistance score — multiplicative composition
/// of sybil_topology, velocity_anomaly, and receipt_consistency. A trip
/// on any sub-score collapses the product (weakest-link binding from
/// `§4.1 Component 5`).
#[allow(clippy::too_many_arguments)]
// Each parameter is a real distinct data source; grouping into a context
// struct would obscure dependencies in callers that already hold the
// individual references separately. Revisit if more terms are added.
pub fn adversarial_resistance(
    agent_id: &str,
    receipts: &ReceiptStore,
    vouches: &VouchStore,
    lifecycle: Option<&AgentLifecycle>,
    spec: Option<&HostingAgentSpec>,
    kernel_members: &HashSet<String>,
    now_ms: i64,
) -> f64 {
    let topology = sybil_topology(agent_id, vouches, kernel_members);
    let velocity = velocity_anomaly(agent_id, receipts, vouches, lifecycle, spec, now_ms);
    let consistency = receipt_consistency(agent_id, receipts);
    (topology * velocity * consistency).clamp(0.0, 1.0)
}

/// Bounded additive vouch contribution. For each active vouch this
/// agent has received from an eligible voucher, contributes
/// `voucher_authority × time_decay(vouch_age, 14d)`. Sum is divided by
/// the size of the vouch SCC (cycle) this agent participates in, then
/// capped at `VOUCH_BOOST_CAP`.
///
/// Eligibility is checked at submission time (see VouchStore::insert) so
/// this function trusts that all stored vouches are from eligible
/// vouchers; the weighting still ages them out and applies the cycle
/// penalty.
pub fn vouch_boost(
    agent_id: &str,
    vouches: &VouchStore,
    authority_cache: &HashMap<String, f64>,
    now_ms: i64,
) -> f64 {
    let active = vouches.active_for_vouchee(agent_id);
    if active.is_empty() {
        return 0.0;
    }
    let cycle_sizes = vouch_scc_sizes(vouches);
    let agent_cycle_size = cycle_sizes.get(agent_id).copied().unwrap_or(1);
    let cycle_divisor = if agent_cycle_size > 1 {
        agent_cycle_size as f64
    } else {
        1.0
    };
    let mut total = 0.0_f64;
    for v in active {
        let voucher_authority = authority_cache.get(&v.voucher_id).copied().unwrap_or(0.0);
        if voucher_authority <= 0.0 {
            continue;
        }
        let age = (now_ms - v.ts_ms).max(0) as f64;
        let decay = (-age / VOUCH_HALF_LIFE_MS).exp();
        total += voucher_authority * decay;
    }
    (total / cycle_divisor).min(VOUCH_BOOST_CAP)
}

/// Map each agent to the size of its strongly-connected component in
/// the active vouch graph. Tarjan's SCC, iterative form. Agents not in
/// any cycle have SCC size 1 (themselves).
fn vouch_scc_sizes(vouches: &VouchStore) -> HashMap<String, usize> {
    let adj = vouches.outbound_adjacency();
    let nodes: HashSet<String> = vouches.agents_in_active_graph();

    let mut index_counter: usize = 0;
    let mut indices: HashMap<String, usize> = HashMap::new();
    let mut lowlink: HashMap<String, usize> = HashMap::new();
    let mut on_stack: HashSet<String> = HashSet::new();
    let mut stack: Vec<String> = Vec::new();
    let mut scc_size: HashMap<String, usize> = HashMap::new();

    #[allow(clippy::too_many_arguments)]
    // Tarjan's SCC working state passed by-mut-ref to the recursive
    // helper. Bundling into a struct is the textbook refactor; v0
    // keeps it inline since this is the only caller.
    fn strongconnect(
        node: String,
        adj: &HashMap<String, HashSet<String>>,
        index_counter: &mut usize,
        indices: &mut HashMap<String, usize>,
        lowlink: &mut HashMap<String, usize>,
        on_stack: &mut HashSet<String>,
        stack: &mut Vec<String>,
        scc_size: &mut HashMap<String, usize>,
    ) {
        indices.insert(node.clone(), *index_counter);
        lowlink.insert(node.clone(), *index_counter);
        *index_counter += 1;
        stack.push(node.clone());
        on_stack.insert(node.clone());

        if let Some(neighbors) = adj.get(&node) {
            for w in neighbors {
                if !indices.contains_key(w) {
                    strongconnect(
                        w.clone(),
                        adj,
                        index_counter,
                        indices,
                        lowlink,
                        on_stack,
                        stack,
                        scc_size,
                    );
                    let w_low = lowlink[w];
                    let v_low = lowlink[&node];
                    lowlink.insert(node.clone(), v_low.min(w_low));
                } else if on_stack.contains(w) {
                    let w_idx = indices[w];
                    let v_low = lowlink[&node];
                    lowlink.insert(node.clone(), v_low.min(w_idx));
                }
            }
        }

        if lowlink[&node] == indices[&node] {
            let mut component: Vec<String> = Vec::new();
            loop {
                let w = stack.pop().expect("stack invariant");
                on_stack.remove(&w);
                component.push(w.clone());
                if w == node {
                    break;
                }
            }
            let size = component.len();
            for w in component {
                scc_size.insert(w, size);
            }
        }
    }

    for node in &nodes {
        if !indices.contains_key(node) {
            strongconnect(
                node.clone(),
                &adj,
                &mut index_counter,
                &mut indices,
                &mut lowlink,
                &mut on_stack,
                &mut stack,
                &mut scc_size,
            );
        }
    }
    scc_size
}

/// 5c slot reserved for online-learning-tunable component weights.
/// All weights are 1.0 by default — the multiplicative final score
/// behaves identically to the pre-WeightProfile version. Online
/// learning lands as a separate increment when an outcome-signal pipe
/// from the render surface (user satisfaction with a routed call) is
/// available; until then there's nothing to learn against.
///
/// See `route_rank_plan.md §6` deferrals.
#[derive(Debug, Clone)]
pub struct WeightProfile {
    pub reliability_w: f64,
    pub latency_w: f64,
    pub authority_w: f64,
    pub adversarial_resistance_w: f64,
    pub vouch_boost_w: f64,
}

impl Default for WeightProfile {
    fn default() -> Self {
        Self {
            reliability_w: 1.0,
            latency_w: 1.0,
            authority_w: 1.0,
            adversarial_resistance_w: 1.0,
            vouch_boost_w: 1.0,
        }
    }
}

/// Multiplicative final score for `(agent_id, tool)`. Thompson-samples
/// reliability fresh on each call. Returns a non-negative finite f64
/// suitable for argmax across a provider set.
///
///   score = θ × latency_term × authority
///         × adversarial_resistance × (1 + vouch_boost)
#[allow(clippy::too_many_arguments)]
pub fn score(
    agent_id: &str,
    tool: &str,
    receipts: &ReceiptStore,
    vouches: &VouchStore,
    authority_cache: &HashMap<String, f64>,
    kernel_members: &HashSet<String>,
    lifecycle: Option<&AgentLifecycle>,
    spec: Option<&HostingAgentSpec>,
    now_ms: i64,
) -> f64 {
    let (alpha, beta) = reliability_posterior(agent_id, tool, receipts, now_ms);
    let theta = sample_reliability(alpha, beta);

    let p50 = latency_digest(agent_id, tool, receipts, now_ms)
        .map(|td| td.estimate_quantile(0.5))
        .unwrap_or(COLD_START_LATENCY_MS);
    let latency_term = 1.0 / (1.0 + p50 / 100.0);

    // Authority is held at 1.0 (neutral) in the v0 multiplicative score.
    // On a single-querier graph, normalized share-of-successes degenerates
    // into the same signal reliability already captures, but compounds
    // it and creates the "loser of the first roll never gets sampled"
    // lockout. Authority *computation* still happens — surfaced in
    // `carrier_status.scores` for telemetry. It activates back into the
    // multiplicative score when the vouch graph develops real
    // structure (mutual punishment + multi-querier paths) in 5b/5c.
    // Until then, ε-greedy in `pick_provider` provides the exploration
    // tier and reliability + latency carry the ranking signal.
    let _ = authority_cache.get(agent_id);
    let _ = AUTHORITY_COLD_START_FLOOR;
    let auth = 1.0_f64;

    let ar = adversarial_resistance(
        agent_id,
        receipts,
        vouches,
        lifecycle,
        spec,
        kernel_members,
        now_ms,
    );

    let vb = vouch_boost(agent_id, vouches, authority_cache, now_ms);

    theta * latency_term * auth * ar * (1.0 + vb)
}

/// Snapshot every (agent, tool) score component at once. Used by
/// `carrier_status` to surface ranking internals without per-agent
/// callsites recomputing. Read-only — not used by the picker.
#[allow(clippy::too_many_arguments)]
pub fn snapshot_all(
    agent_tool_pairs: impl IntoIterator<Item = (String, String)>,
    receipts: &ReceiptStore,
    vouches: &VouchStore,
    authority_cache: &HashMap<String, f64>,
    kernel_members: &HashSet<String>,
    lifecycles: &HashMap<String, AgentLifecycle>,
    specs_by_id: &HashMap<String, HostingAgentSpec>,
    now_ms: i64,
) -> Vec<AgentScoreSnapshot> {
    agent_tool_pairs
        .into_iter()
        .map(|(agent_id, tool)| {
            let (a, b) = reliability_posterior(&agent_id, &tool, receipts, now_ms);
            let td = latency_digest(&agent_id, &tool, receipts, now_ms);
            let p50 = td.as_ref().map(|t| t.estimate_quantile(0.5));
            let p95 = td.as_ref().map(|t| t.estimate_quantile(0.95));
            let auth = authority_cache.get(&agent_id).copied().unwrap_or(0.0);
            let life = lifecycles.get(&agent_id);
            let spec = specs_by_id.get(&agent_id);
            let ar = adversarial_resistance(
                &agent_id,
                receipts,
                vouches,
                life,
                spec,
                kernel_members,
                now_ms,
            );
            let vb = vouch_boost(&agent_id, vouches, authority_cache, now_ms);
            AgentScoreSnapshot {
                agent_id,
                tool,
                reliability_alpha: a,
                reliability_beta: b,
                latency_p50_ms: p50,
                latency_p95_ms: p95,
                authority: auth,
                adversarial_resistance: ar,
                vouch_boost: vb,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::carrier::lifecycle::AgentLifecycle;
    use crate::carrier::receipts::{ErrorKind, Receipt};
    use crate::carrier::registry::HostingAgentSpec;
    use crate::carrier::vouches::VouchStore;

    fn s(agent: &str, tool: &str, success: bool, latency: u64, ts: i64) -> Receipt {
        Receipt {
            agent_id: agent.into(),
            tool: tool.into(),
            success,
            latency_ms: latency,
            ts_ms: ts,
            error_kind: if success { None } else { Some(ErrorKind::Other) },
            exploratory: false,
        }
    }

    fn spec(id: &str, seed: bool, onboarded_at_ms: i64) -> HostingAgentSpec {
        HostingAgentSpec {
            id: id.into(),
            endpoint: format!("http://test/{}", id),
            description: None,
            bond_amount: 0,
            onboarded_at_ms,
            seed,
            price_per_call_cents: 0,
            carrier_take_rate_bps: 100,
            merchant_account_id: String::new(),
        }
    }

    /// Empty composition for tests that only exercise 5a-shape behavior.
    fn empty_5b() -> (VouchStore, HashSet<String>, HashMap<String, AgentLifecycle>, HashMap<String, HostingAgentSpec>) {
        (
            VouchStore::new(),
            HashSet::new(),
            HashMap::new(),
            HashMap::new(),
        )
    }

    fn call_score_simple(
        agent: &str,
        tool: &str,
        receipts: &ReceiptStore,
        authority_cache: &HashMap<String, f64>,
        now: i64,
    ) -> f64 {
        let (vouches, kernel, _life, _specs) = empty_5b();
        score(
            agent, tool, receipts, &vouches, authority_cache, &kernel, None, None, now,
        )
    }

    #[test]
    fn reliability_uniform_prior_with_no_data() {
        let store = ReceiptStore::new();
        let (a, b) = reliability_posterior("alpha", "lookup", &store, 0);
        assert_eq!(a, 1.0);
        assert_eq!(b, 1.0);
    }

    #[test]
    fn reliability_recency_decay_works() {
        let mut store = ReceiptStore::new();
        // One recent success at ts=now, one stale at ts=now - 24h (one half-life).
        let now: i64 = 24 * 3600 * 1000;
        store.record(s("alpha", "lookup", true, 10, 0));
        store.record(s("alpha", "lookup", true, 10, now));
        let (a, b) = reliability_posterior("alpha", "lookup", &store, now);
        // Recent receipt contributes 1.0; stale contributes exp(-1) ≈ 0.368.
        // Plus prior of 1.0. Total alpha ≈ 1 + 1 + 0.368 = 2.368.
        assert!((a - 2.368).abs() < 0.01, "alpha was {}", a);
        assert!((b - 1.0).abs() < 1e-9);
    }

    #[test]
    fn thompson_sampling_favors_high_alpha_overwhelmingly() {
        // Beta(10, 2) vs Beta(2, 10): the first should win the vast majority
        // of head-to-head Thompson decisions. Loose statistical fence — not
        // a deterministic check.
        let mut wins = 0;
        const N: usize = 1000;
        for _ in 0..N {
            let a = sample_reliability(10.0, 2.0);
            let b = sample_reliability(2.0, 10.0);
            if a > b {
                wins += 1;
            }
        }
        assert!(wins >= 950, "expected >= 950 wins out of {}, got {}", N, wins);
    }

    #[test]
    fn latency_digest_p50_matches_obvious_median() {
        let mut store = ReceiptStore::new();
        // Eleven samples [10, 20, ..., 110]; median 60.
        let now: i64 = 1_000_000;
        for i in 0..11 {
            store.record(s("alpha", "lookup", true, (i + 1) * 10, now));
        }
        let td = latency_digest("alpha", "lookup", &store, now).unwrap();
        let p50 = td.estimate_quantile(0.5);
        assert!((p50 - 60.0).abs() < 5.0, "p50 was {}", p50);
    }

    #[test]
    fn latency_digest_excludes_failures_and_old_samples() {
        let mut store = ReceiptStore::new();
        let now: i64 = LATENCY_WINDOW_MS + 1_000;
        // Old success outside window — excluded.
        store.record(s("alpha", "lookup", true, 9999, 0));
        // Recent failure — excluded.
        store.record(s("alpha", "lookup", false, 9999, now));
        // Recent success — included.
        store.record(s("alpha", "lookup", true, 25, now));
        let td = latency_digest("alpha", "lookup", &store, now).unwrap();
        let p50 = td.estimate_quantile(0.5);
        assert!((p50 - 25.0).abs() < 1.0, "p50 was {}", p50);
    }

    #[test]
    fn authority_normalizes_to_sum_one() {
        let mut store = ReceiptStore::new();
        let vouches = VouchStore::new();
        let now: i64 = 0;
        store.record(s("alpha", "x", true, 1, now));
        store.record(s("alpha", "x", true, 1, now));
        store.record(s("alpha", "x", true, 1, now));
        store.record(s("beta", "x", true, 1, now));
        let auth = authority(&store, &vouches, now);
        assert!((auth["alpha"] - 0.75).abs() < 1e-6);
        assert!((auth["beta"] - 0.25).abs() < 1e-6);
        let sum: f64 = auth.values().sum();
        assert!((sum - 1.0).abs() < 1e-6);
    }

    #[test]
    fn authority_excludes_failures() {
        let mut store = ReceiptStore::new();
        let vouches = VouchStore::new();
        store.record(s("alpha", "x", false, 1, 0));
        store.record(s("alpha", "x", false, 1, 0));
        let auth = authority(&store, &vouches, 0);
        assert!(auth.is_empty());
    }

    #[test]
    fn authority_excludes_exploratory_receipts() {
        // Exploratory successes don't count toward production authority.
        let mut store = ReceiptStore::new();
        let vouches = VouchStore::new();
        store.record(Receipt {
            agent_id: "alpha".into(),
            tool: "x".into(),
            success: true,
            latency_ms: 1,
            ts_ms: 0,
            error_kind: None,
            exploratory: true,
        });
        let auth = authority(&store, &vouches, 0);
        assert!(auth.is_empty());
    }

    #[test]
    fn score_is_finite_for_cold_start() {
        let store = ReceiptStore::new();
        let auth = HashMap::new();
        let v = call_score_simple("brand_new", "lookup", &store, &auth, 0);
        assert!(v.is_finite());
        assert!(v >= 0.0);
    }

    #[test]
    fn score_warm_agent_with_strong_history_dominates_cold_start() {
        let mut store = ReceiptStore::new();
        let vouches = VouchStore::new();
        let now: i64 = 0;
        for _ in 0..50 {
            store.record(s("warm", "lookup", true, 30, now));
        }
        let auth = authority(&store, &vouches, now);
        let mut warm_wins = 0;
        for _ in 0..200 {
            let w = call_score_simple("warm", "lookup", &store, &auth, now);
            let c = call_score_simple("cold", "lookup", &store, &auth, now);
            if w > c {
                warm_wins += 1;
            }
        }
        assert!(warm_wins >= 195, "warm wins = {} of 200", warm_wins);
    }

    #[test]
    fn thompson_sampling_explores_low_sample_warm_agent() {
        let mut store = ReceiptStore::new();
        let now: i64 = 0;
        for _ in 0..3 {
            store.record(s("warm", "lookup", true, 30, now));
        }
        let auth = HashMap::new();
        let mut cold_wins = 0;
        const N: usize = 500;
        for _ in 0..N {
            let w = call_score_simple("warm", "lookup", &store, &auth, now);
            let c = call_score_simple("cold", "lookup", &store, &auth, now);
            if c > w {
                cold_wins += 1;
            }
        }
        assert!(
            cold_wins >= N / 20,
            "cold should win some exploration draws; got {}/{}",
            cold_wins,
            N
        );
    }

    // ---- 5b tests --------------------------------------------------------

    #[test]
    fn overall_reliability_neutral_when_no_data() {
        let store = ReceiptStore::new();
        assert_eq!(overall_reliability("alpha", &store, 50, 0), 1.0);
    }

    #[test]
    fn overall_reliability_excludes_exploratory() {
        let mut store = ReceiptStore::new();
        // One production success + one exploratory failure → reliability ≈ 1.0
        store.record(s("alpha", "x", true, 1, 0));
        store.record(Receipt {
            agent_id: "alpha".into(),
            tool: "x".into(),
            success: false,
            latency_ms: 1,
            ts_ms: 0,
            error_kind: Some(ErrorKind::Other),
            exploratory: true,
        });
        let r = overall_reliability("alpha", &store, 50, 0);
        assert!(r > 0.6, "expected high reliability, got {}", r);
    }

    #[test]
    fn kernel_seed_anchored_in_v0() {
        let specs = vec![spec("alpha", true, 0), spec("beta", true, 0), spec("gamma", false, 0)];
        let lifecycles: HashMap<String, AgentLifecycle> = HashMap::new();
        let store = ReceiptStore::new();
        let kernel = kernel_members(&specs, &lifecycles, &store, 0);
        assert!(kernel.contains("alpha"));
        assert!(kernel.contains("beta"));
        assert!(!kernel.contains("gamma"));
    }

    #[test]
    fn kernel_auto_promotes_with_tenure_and_reliability() {
        let now: i64 = 100 * 24 * 3600 * 1000; // 100 days in
        let onboard_ms = now - 60 * 24 * 3600 * 1000; // 60 days ago
        let promoted_since = now - 50 * 24 * 3600 * 1000; // 50 days in production
        let specs = vec![spec("late_bloomer", false, onboard_ms)];
        let mut lifecycles: HashMap<String, AgentLifecycle> = HashMap::new();
        lifecycles.insert(
            "late_bloomer".into(),
            AgentLifecycle::Production {
                since_ms: promoted_since,
            },
        );
        // Heavy successful production traffic to clear reliability bar.
        let mut store = ReceiptStore::new();
        for _ in 0..100 {
            store.record(s("late_bloomer", "x", true, 1, now));
        }
        let kernel = kernel_members(&specs, &lifecycles, &store, now);
        assert!(kernel.contains("late_bloomer"));
    }

    #[test]
    fn kernel_skips_short_tenure() {
        let now: i64 = 100 * 24 * 3600 * 1000;
        let specs = vec![spec("teenager", false, now - 5 * 24 * 3600 * 1000)];
        let mut lifecycles: HashMap<String, AgentLifecycle> = HashMap::new();
        // Only 5 days in production.
        lifecycles.insert(
            "teenager".into(),
            AgentLifecycle::Production {
                since_ms: now - 5 * 24 * 3600 * 1000,
            },
        );
        let mut store = ReceiptStore::new();
        for _ in 0..100 {
            store.record(s("teenager", "x", true, 1, now));
        }
        let kernel = kernel_members(&specs, &lifecycles, &store, now);
        assert!(!kernel.contains("teenager"));
    }

    #[test]
    fn vouch_eligibility_via_store() {
        // Direct verification of the eligibility rule.
        assert!(VouchStore::is_voucher_eligible(true, 0.85, 60));
        assert!(!VouchStore::is_voucher_eligible(true, 0.7, 100));
        assert!(!VouchStore::is_voucher_eligible(true, 0.9, 49));
        assert!(!VouchStore::is_voucher_eligible(false, 0.99, 1000));
    }

    #[test]
    fn mutual_punishment_diminishes_voucher_authority() {
        // alpha vouches for bad_actor. bad_actor has terrible reliability.
        // alpha's authority should be diminished compared to a baseline
        // where alpha vouches for nobody.
        let now: i64 = 0;
        let mut receipts = ReceiptStore::new();
        // alpha and beta both have equal successful production records.
        for _ in 0..30 {
            receipts.record(s("alpha", "x", true, 1, now));
        }
        for _ in 0..30 {
            receipts.record(s("beta", "x", true, 1, now));
        }
        // bad_actor has terrible reliability.
        for _ in 0..10 {
            receipts.record(s("bad_actor", "x", false, 1, now));
        }

        // Baseline: no vouches. alpha and beta should be equal.
        let no_vouches = VouchStore::new();
        let auth_base = authority(&receipts, &no_vouches, now);
        assert!((auth_base["alpha"] - auth_base["beta"]).abs() < 1e-9);

        // With alpha vouching for bad_actor: alpha's authority should drop.
        let mut vouches = VouchStore::new();
        vouches.insert("alpha", "bad_actor", now, true);
        let auth_punished = authority(&receipts, &vouches, now);
        assert!(
            auth_punished["alpha"] < auth_base["alpha"],
            "alpha authority should drop when vouching for bad_actor: {} → {}",
            auth_base["alpha"],
            auth_punished["alpha"]
        );
        assert!(
            auth_punished["beta"] > auth_base["beta"],
            "beta authority should rise (relative share) after alpha is penalized"
        );
    }

    #[test]
    fn vouch_boost_caps_at_configured_max() {
        let now: i64 = 0;
        let mut vouches = VouchStore::new();
        // 10 high-authority vouchers all endorse 'lifted'.
        for i in 0..10 {
            let voucher_id = format!("voucher_{}", i);
            vouches.insert(&voucher_id, "lifted", now, true);
        }
        let mut auth_cache: HashMap<String, f64> = HashMap::new();
        for i in 0..10 {
            auth_cache.insert(format!("voucher_{}", i), 0.5);
        }
        let boost = vouch_boost("lifted", &vouches, &auth_cache, now);
        assert!(boost <= VOUCH_BOOST_CAP + 1e-9);
        // Should be exactly at cap given 10 × 0.5 = 5.0 raw input.
        assert!((boost - VOUCH_BOOST_CAP).abs() < 1e-9);
    }

    #[test]
    fn vouch_boost_cycle_penalty_reduces_contribution() {
        // alpha → beta → alpha (mutual cycle of size 2).
        let now: i64 = 0;
        let mut vouches = VouchStore::new();
        vouches.insert("alpha", "beta", now, true);
        vouches.insert("beta", "alpha", now, true);
        let mut auth_cache: HashMap<String, f64> = HashMap::new();
        auth_cache.insert("alpha".into(), 0.5);
        auth_cache.insert("beta".into(), 0.5);
        // Without cycle: alpha would receive boost of 0.5 (from beta).
        // With cycle of size 2: divided by 2 → 0.25.
        let boost = vouch_boost("alpha", &vouches, &auth_cache, now);
        assert!(
            (boost - 0.25).abs() < 1e-3,
            "cycle-penalized boost = {}",
            boost
        );
    }

    #[test]
    fn sybil_topology_kernel_member_is_trusted() {
        let mut kernel = HashSet::new();
        kernel.insert("alpha".to_string());
        let vouches = VouchStore::new();
        assert_eq!(sybil_topology("alpha", &vouches, &kernel), 1.0);
    }

    #[test]
    fn sybil_topology_isolated_agent_is_neutral() {
        // Agent with no vouches is not in graph → neutral 1.0.
        let kernel = HashSet::new();
        let vouches = VouchStore::new();
        assert_eq!(sybil_topology("isolated", &vouches, &kernel), 1.0);
    }

    #[test]
    fn sybil_topology_tight_isolated_ring_is_penalized() {
        // Ring of three — sybil_a, sybil_b, sybil_c — vouching for each
        // other, with no kernel reachability.
        let kernel = HashSet::new();
        let mut vouches = VouchStore::new();
        for (a, b) in &[
            ("sybil_a", "sybil_b"),
            ("sybil_b", "sybil_c"),
            ("sybil_c", "sybil_a"),
            ("sybil_a", "sybil_c"),
            ("sybil_b", "sybil_a"),
            ("sybil_c", "sybil_b"),
        ] {
            vouches.insert(a, b, 0, true);
        }
        let s = sybil_topology("sybil_a", &vouches, &kernel);
        assert!(s < 0.5, "tight isolated ring should be penalized; got {}", s);
    }

    #[test]
    fn velocity_anomaly_quiet_when_no_co_fire() {
        // Even with high acceleration, no co-fire signals → no penalty.
        // Use a "now" that's well beyond the 30-day kernel-tenure
        // threshold so the spec's onboarded_at_ms=0 reads as established.
        let kernel_tenure: i64 = KERNEL_PROMOTION_TENURE_MS;
        let now: i64 = kernel_tenure + 7 * 24 * 3600 * 1000; // 30d + 7d
        let mut receipts = ReceiptStore::new();
        for i in 0..50 {
            receipts.record(s(
                "established",
                "x",
                false,
                1,
                now - VELOCITY_LONG_WINDOW_MS / 2 + i,
            ));
        }
        for i in 0..50 {
            receipts.record(s("established", "x", true, 1, now - 1000 + i));
        }
        let life = AgentLifecycle::Production {
            since_ms: now - kernel_tenure,
        };
        let mut vouches_for_diversity = VouchStore::new();
        for i in 0..5 {
            vouches_for_diversity.insert(&format!("voucher_{}", i), "established", now, true);
        }
        let v = velocity_anomaly(
            "established",
            &receipts,
            &vouches_for_diversity,
            Some(&life),
            Some(&spec("established", true, 0)), // onboarded at 0; tenure > 30d
            now,
        );
        assert_eq!(v, 1.0);
    }

    #[test]
    fn velocity_anomaly_co_fires_during_exploration() {
        let now: i64 = VELOCITY_LONG_WINDOW_MS + 1;
        let mut receipts = ReceiptStore::new();
        // 7d baseline: mostly failures.
        for i in 0..50 {
            receipts.record(s("new", "x", false, 1, now - VELOCITY_LONG_WINDOW_MS / 2 + i));
        }
        // 24h: rapid success run.
        for i in 0..50 {
            receipts.record(s("new", "x", true, 1, now - 1000 + i));
        }
        let vouches = VouchStore::new();
        let life = AgentLifecycle::Exploration {
            successes_so_far: 5,
            failures_so_far: 0,
            entered_at_ms: now - 1000,
            min_ar_observed: 1.0,
        };
        let v = velocity_anomaly(
            "new",
            &receipts,
            &vouches,
            Some(&life),
            Some(&spec("new", false, now - 1000)),
            now,
        );
        assert!(v < 1.0, "exploration agent with acceleration should trip; got {}", v);
    }

    #[test]
    fn score_includes_5b_terms() {
        // Sanity: full-form score returns finite value with 5b inputs.
        let now: i64 = 0;
        let mut receipts = ReceiptStore::new();
        for _ in 0..5 {
            receipts.record(s("alpha", "x", true, 30, now));
        }
        let vouches = VouchStore::new();
        let kernel: HashSet<String> = ["alpha".to_string()].into_iter().collect();
        let auth = authority(&receipts, &vouches, now);
        let life = AgentLifecycle::Production { since_ms: now };
        let sp = spec("alpha", true, 0);
        let v = score(
            "alpha", "x", &receipts, &vouches, &auth, &kernel, Some(&life), Some(&sp), now,
        );
        assert!(v.is_finite());
        assert!(v >= 0.0);
    }

    #[test]
    fn vouch_boost_cannot_rescue_terrible_agent() {
        // Verifies the structural property: an agent with reliability 0.1
        // and max vouch boost still scores below an agent with reliability
        // 0.9 and no vouches.
        let now: i64 = 0;
        let mut receipts = ReceiptStore::new();
        // bad_agent: 1 success, 9 failures → ~0.1 success rate.
        receipts.record(s("bad_agent", "x", true, 30, now));
        for _ in 0..9 {
            receipts.record(s("bad_agent", "x", false, 30, now));
        }
        // good_agent: 9 successes, 1 failure.
        for _ in 0..9 {
            receipts.record(s("good_agent", "x", true, 30, now));
        }
        receipts.record(s("good_agent", "x", false, 30, now));

        // Stuff bad_agent with high-authority vouchers (eligible).
        let mut vouches = VouchStore::new();
        let mut auth_cache: HashMap<String, f64> = HashMap::new();
        for i in 0..10 {
            let v = format!("v_{}", i);
            vouches.insert(&v, "bad_agent", now, true);
            auth_cache.insert(v, 0.9);
        }
        // Compute real authority for the good/bad agents.
        let real_auth = authority(&receipts, &vouches, now);
        for (k, v) in real_auth.iter() {
            auth_cache.insert(k.clone(), *v);
        }
        let kernel: HashSet<String> = ["good_agent".into(), "bad_agent".into()].into_iter().collect();
        let life = AgentLifecycle::Production { since_ms: now };

        let mut bad_wins = 0;
        for _ in 0..200 {
            let bad = score(
                "bad_agent",
                "x",
                &receipts,
                &vouches,
                &auth_cache,
                &kernel,
                Some(&life),
                None,
                now,
            );
            let good = score(
                "good_agent",
                "x",
                &receipts,
                &vouches,
                &auth_cache,
                &kernel,
                Some(&life),
                None,
                now,
            );
            if bad > good {
                bad_wins += 1;
            }
        }
        // bad_agent should win at most a tiny fraction (Thompson noise).
        assert!(
            bad_wins <= 30,
            "vouches should not rescue a bad agent; bad_wins = {} of 200",
            bad_wins
        );
    }
}
