// Payments substrate (RouteRank step 5c.3 — scaffold).
//
// Architectural principle: USE, DON'T BUILD. Stripe + Coinbase handle
// payment processing, escrow, dispute, and compliance. The carrier
// integrates against their primitives via the `PaymentBackend` trait
// and never rolls its own settlement layer.
//
// v0 scope (this scaffold):
//   - PaymentBackend trait — the abstraction every consumer (lifecycle
//     bond hooks, take-rate hooks, future ACP/x402 settlement) routes
//     through.
//   - StubBackend (default) — logs all calls, returns synthetic IDs.
//     Demo runs end-to-end without any payment configuration. This is
//     what `RoutingCarrier::new` wires by default.
//   - StripeBackend (skeleton, deferred) — placeholder module with
//     method signatures. Real implementation against the
//     `async-stripe` SDK lives in a follow-up PR; it's not on the v0
//     critical path because `route_rank_plan.md §6` defers it
//     explicitly. The skeleton's purpose here is to make the trait
//     surface concrete enough that the follow-up PR is mechanical.
//
// Deferred for follow-up PRs (tracked in `route_rank_plan.md §6`):
//   - Real Stripe Connect Custom + delayed-payouts integration for
//     fiat bond escrow.
//   - Stripe Connect destination charges with `application_fee_amount`
//     for take-rate splits.
//   - x402 challenge-response middleware.
//   - MPP session-token handling.
//   - TAP signature verification on inbound ACP requests.
//   - Tempo on-chain USDC escrow for the v1+ on-chain bond branch.

pub mod stripe_skeleton;
pub mod stub;

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum PaymentError {
    #[error("backend not configured (use Stub or wire StripeBackend)")]
    NotConfigured,
    #[error("backend rejected operation: {0}")]
    Rejected(String),
    #[error("transport error: {0}")]
    Transport(String),
}

/// Currency-aware amount. v0 only handles integer cents-shape values
/// (USD-equivalent) because that's what every fiat backend needs.
/// On-chain branches (Tempo USDC) will need a fixed-point USDC type
/// when wired; defer.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Amount {
    pub cents: i64,
    pub currency: Currency,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Currency {
    Usd,
    Usdc,
}

impl Amount {
    pub fn usd(cents: i64) -> Self {
        Self {
            cents,
            currency: Currency::Usd,
        }
    }
}

/// Opaque ID returned by the backend. Carriers store these on their
/// side so they can reconcile lifecycle events (forfeit, release) with
/// the underlying settlement.
#[derive(Debug, Clone, Serialize)]
pub struct BondId(pub String);

#[derive(Debug, Clone, Serialize)]
pub struct ChargeId(pub String);

/// Take-rate split for a single transaction. The carrier's cut is
/// `application_fee_amount` in Stripe Connect terminology.
#[derive(Debug, Clone)]
pub struct TakeRateSplit {
    pub gross: Amount,
    pub carrier_cut: Amount,
    pub merchant_account_id: String,
}

/// Backend for bond escrow + take-rate splits. The trait is
/// deliberately small — every method is one settlement operation —
/// so a minimum-viable backend is achievable without modeling the full
/// payments domain.
pub trait PaymentBackend: Send + Sync {
    /// Human-readable backend label for telemetry.
    fn name(&self) -> &'static str;

    /// Create an escrow holding `agent_id`'s bond. Returns the bond id
    /// the carrier records against the agent's lifecycle.
    fn escrow_bond(&self, agent_id: &str, amount: Amount) -> Result<BondId, PaymentError>;

    /// Release `bond_id` back to the agent (typical Production
    /// graduation outcome).
    fn release_bond(&self, bond_id: &BondId) -> Result<(), PaymentError>;

    /// Forfeit `bond_id` to the carrier's revenue account
    /// (adversarial-resistance trip outcome).
    fn forfeit_bond(&self, bond_id: &BondId) -> Result<(), PaymentError>;

    /// Settle a take-rate split — gross goes to merchant, carrier_cut
    /// goes to the carrier's revenue account.
    fn settle_take_rate(&self, split: TakeRateSplit) -> Result<ChargeId, PaymentError>;
}

pub use stub::StubBackend;
