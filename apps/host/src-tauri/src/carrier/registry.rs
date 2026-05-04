// Hosting agent registry. Parses `config/hosting-agents.md` into a list
// of HostingAgentSpec records the carrier connects to at boot.
//
// Re-uses crate::config_parser to split the markdown into sections; each
// `## ` section is one agent. Body lines are simple `key: value` pairs.
//
// Required: `endpoint`.
// Optional: `description`, `bond_amount`, `onboarded_at_ms`, `seed`.
//   - `bond_amount` is a placeholder integer ahead of the payments
//     substrate (5c). Defaults to 0; positive values mark agents that
//     have posted exploration bonds.
//   - `onboarded_at_ms` starts the tenure clock for kernel promotion
//     and voucher eligibility (`docs/route_rank_plan.md §4.3`).
//     Defaults to "now-at-boot" so config-declared agents start with
//     fresh tenure unless explicitly set.
//   - `seed: true` forces a config-anchored kernel membership and skips
//     exploration on first boot. Used for the manually-onboarded
//     anchor set per `§3.1` / `§4.3`.
//
// v0: registry is read once at boot. Hot-reload of agent additions /
// removals at runtime is a follow-up — graceful tear-down of in-flight
// sessions makes that non-trivial.
//
// 5c also reserves a peer-carrier registry slot (`PeerCarrierSpec`).
// Federation cross-carrier consistency checks (`§4.1 Component 4`'s
// last sub-bullet) need this — when a peer carrier exposes its receipt
// summary stream, the local carrier compares the same agent's
// reputation across carriers and flags large divergences. v0 demo has
// no peers, so the spec exists only as an empty data shape.

use std::path::Path;

use crate::config_parser;

#[derive(Debug, Clone)]
pub struct HostingAgentSpec {
    pub id: String,
    pub endpoint: String,
    pub description: Option<String>,
    /// Placeholder bond amount until the payments substrate (5c) wires
    /// in. Non-zero values mark agents that have posted exploration
    /// bonds; the picker's slash hook reads this when an
    /// adversarial-resistance trip happens during exploration.
    pub bond_amount: u64,
    /// Wall-clock ms timestamp when this agent first onboarded. Tenure
    /// (now − onboarded_at_ms) gates kernel promotion and voucher
    /// eligibility. Falls back to "now-at-load" for unspecified agents.
    pub onboarded_at_ms: i64,
    /// `true` for manually-onboarded anchor agents that participate in
    /// the v0 trust kernel without going through exploration. The
    /// long-term answer is auto-promotion based on tenure + reliability,
    /// implemented in `scoring::kernel_members`; this flag bootstraps
    /// the kernel before any agent has accumulated tenure.
    pub seed: bool,
    /// 5c — capability-declaration pricing. Cents-per-call, USD by
    /// default. `0` (the v0 default) means "no charge — free routing."
    /// When non-zero, the carrier will route the call through the
    /// payments backend's `settle_take_rate` with the configured
    /// `carrier_take_rate_bps` cut. Real take-rate enforcement waits
    /// for ACP / Stripe Connect wiring (see `route_rank_plan.md §6`).
    pub price_per_call_cents: i64,
    /// Carrier take-rate in basis points (1/100 of a percent). Default
    /// 100 = 1.00%. Per-agent override possible when high-value
    /// categories warrant a different cut. Visa-style economics —
    /// `route_rank_plan.md §2.2`.
    pub carrier_take_rate_bps: u32,
    /// Stripe Connect destination account id, when present. Empty
    /// string means take-rate splits route to the fallback default
    /// (which the StubBackend logs but doesn't pay anyone).
    pub merchant_account_id: String,
}

/// 5c federation slot. Reserved data shape for peer carriers the local
/// carrier reads receipt-summary streams from. Empty in v0; activates
/// when at least one peer carrier exists and the cross-carrier
/// consistency hook (per `§4.1 Component 4`) is wired. See
/// `route_rank_plan.md §6` deferrals.
#[derive(Debug, Clone)]
#[allow(dead_code)] // slot-reservation; populated when the federation hook lands
pub struct PeerCarrierSpec {
    pub id: String,
    pub receipt_summary_endpoint: String,
    pub public_key_b64: String,
}

pub fn load_from_path(path: &Path) -> Result<Vec<HostingAgentSpec>, String> {
    let contents = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(parse(&contents, now_ms()))
}

/// Parse the registry markdown. `default_onboarded_at_ms` is used for
/// any agent that doesn't declare `onboarded_at_ms` itself — typically
/// "now" at boot, but tests pass a fixed value for determinism.
pub fn parse(contents: &str, default_onboarded_at_ms: i64) -> Vec<HostingAgentSpec> {
    let doc = config_parser::parse(contents);
    doc.sections
        .into_iter()
        .filter_map(|section| {
            let endpoint = extract_kv(&section.body, "endpoint")?;
            Some(HostingAgentSpec {
                id: section.heading,
                endpoint,
                description: extract_kv(&section.body, "description"),
                bond_amount: extract_kv(&section.body, "bond_amount")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0),
                onboarded_at_ms: extract_kv(&section.body, "onboarded_at_ms")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(default_onboarded_at_ms),
                // Default to seed=true at v0 for the manually-onboarded
                // anchor pattern. Once a real onboarding flow exists,
                // new agents enter with seed=false and have to earn
                // kernel membership through tenure + reliability.
                seed: extract_kv(&section.body, "seed")
                    .map(|s| s.eq_ignore_ascii_case("true"))
                    .unwrap_or(true),
                price_per_call_cents: extract_kv(&section.body, "price_per_call_cents")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0),
                carrier_take_rate_bps: extract_kv(&section.body, "carrier_take_rate_bps")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(100), // 1.00% default
                merchant_account_id: extract_kv(&section.body, "merchant_account_id")
                    .unwrap_or_default(),
            })
        })
        .collect()
}

fn extract_kv(body: &str, key: &str) -> Option<String> {
    let needle = format!("{}:", key);
    body.lines().find_map(|line| {
        let l = line.trim();
        l.strip_prefix(&needle).map(|rest| rest.trim().to_string())
    })
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_two_agents() {
        let input = "# Hosting Agents\n\n## alpha\nendpoint: http://127.0.0.1:4717/mcp\ndescription: First.\n\n## beta\nendpoint: http://127.0.0.1:4718/mcp\n";
        let v = parse(input, 1_000);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].id, "alpha");
        assert_eq!(v[0].endpoint, "http://127.0.0.1:4717/mcp");
        assert_eq!(v[0].description.as_deref(), Some("First."));
        assert_eq!(v[0].onboarded_at_ms, 1_000);
        assert_eq!(v[0].bond_amount, 0);
        assert!(v[0].seed); // default
        assert_eq!(v[0].price_per_call_cents, 0); // free by default
        assert_eq!(v[0].carrier_take_rate_bps, 100); // 1.00% default
        assert_eq!(v[1].id, "beta");
        assert!(v[1].description.is_none());
    }

    #[test]
    fn skips_sections_without_endpoint() {
        let input = "## broken\ndescription: missing endpoint";
        assert!(parse(input, 0).is_empty());
    }

    #[test]
    fn empty_input_yields_no_agents() {
        assert!(parse("", 0).is_empty());
    }

    #[test]
    fn parses_optional_5b_fields() {
        let input = "## new_agent\nendpoint: http://127.0.0.1:5000/mcp\nbond_amount: 1500\nonboarded_at_ms: 12345\nseed: false";
        let v = parse(input, 0);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].bond_amount, 1500);
        assert_eq!(v[0].onboarded_at_ms, 12345);
        assert!(!v[0].seed);
    }
}
