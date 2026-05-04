// Stripe Connect backend — SKELETON only. v0 ships this file as the
// shape future PRs will fill in; the methods are intentionally
// unimplemented so the trait surface is concrete without us pretending
// the integration works yet.
//
// The follow-up PR that lights this up will:
//   - Add `async-stripe` (currently absent — its Rust 1.88 floor is
//     why we deferred). Either wait for a 1.88+ baseline, or use
//     reqwest directly against the Stripe REST API for the few
//     endpoints we need (Connect accounts, PaymentIntents with
//     `application_fee_amount`, delayed payouts).
//   - Read STRIPE_SECRET_KEY + STRIPE_CONNECT_MERCHANT_ID from the
//     environment / Tauri secret store. Demo runs in test mode unless
//     LIVE keys are explicitly configured.
//   - Wire the backend into `RoutingCarrier` only when keys are
//     present. Otherwise the carrier keeps using the stub.
//
// Tracked in `route_rank_plan.md §6` deferred items.

use super::{Amount, BondId, ChargeId, PaymentBackend, PaymentError, TakeRateSplit};

#[allow(dead_code)] // skeleton — fields will be populated by the follow-up PR
pub struct StripeBackend {
    secret_key: String,
    connect_account_id: String,
}

#[allow(dead_code)]
impl StripeBackend {
    pub fn new(secret_key: String, connect_account_id: String) -> Self {
        Self {
            secret_key,
            connect_account_id,
        }
    }
}

impl PaymentBackend for StripeBackend {
    fn name(&self) -> &'static str {
        "stripe_skeleton"
    }

    fn escrow_bond(&self, _agent_id: &str, _amount: Amount) -> Result<BondId, PaymentError> {
        // Real implementation: create a PaymentIntent on the carrier's
        // platform account with `transfer_data.destination` pointing at
        // the agent's connected account, with a delayed-payout schedule
        // (≤90d) holding the funds. Bond id = the PaymentIntent id.
        Err(PaymentError::NotConfigured)
    }

    fn release_bond(&self, _bond_id: &BondId) -> Result<(), PaymentError> {
        // Real implementation: trigger the delayed payout to the
        // agent's connected account.
        Err(PaymentError::NotConfigured)
    }

    fn forfeit_bond(&self, _bond_id: &BondId) -> Result<(), PaymentError> {
        // Real implementation: cancel the delayed payout and reverse
        // the transfer back to the platform account (carrier revenue).
        Err(PaymentError::NotConfigured)
    }

    fn settle_take_rate(&self, _split: TakeRateSplit) -> Result<ChargeId, PaymentError> {
        // Real implementation: PaymentIntent with `application_fee_amount`
        // = carrier_cut, destination = merchant_account_id. Stripe handles
        // the split.
        Err(PaymentError::NotConfigured)
    }
}
