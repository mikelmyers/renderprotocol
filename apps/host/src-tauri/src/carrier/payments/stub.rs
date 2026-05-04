// Default `PaymentBackend` for v0 — logs every operation, returns
// synthetic IDs. The demo runs end-to-end without any real payment
// configuration; this is what gets wired by `RoutingCarrier::new`.
//
// When the real Stripe / on-chain backends arrive, swap this for the
// configured implementation behind the same trait. Call sites don't
// change.

use parking_lot::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use super::{Amount, BondId, ChargeId, PaymentBackend, PaymentError, TakeRateSplit};

pub struct StubBackend {
    counter: AtomicU64,
    /// Bookkeeping for tests / introspection: tracks issued bonds and
    /// their states. v0 demo has no use for this beyond the test
    /// suite; surfaces here so a UI can sanity-check the wiring.
    history: Mutex<Vec<StubEvent>>,
}

#[derive(Debug, Clone)]
pub enum StubEvent {
    EscrowBond {
        agent_id: String,
        amount: Amount,
        bond_id: BondId,
    },
    ReleaseBond {
        bond_id: BondId,
    },
    ForfeitBond {
        bond_id: BondId,
    },
    SettleTakeRate {
        gross: Amount,
        carrier_cut: Amount,
        merchant_account_id: String,
        charge_id: ChargeId,
    },
}

impl Default for StubBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl StubBackend {
    pub fn new() -> Self {
        Self {
            counter: AtomicU64::new(1),
            history: Mutex::new(Vec::new()),
        }
    }

    fn next_id(&self, prefix: &str) -> String {
        let n = self.counter.fetch_add(1, Ordering::SeqCst);
        format!("stub_{}_{}", prefix, n)
    }

    /// Snapshot the event history. Test-only / debug-only — production
    /// callers should not rely on the stub's internal log.
    pub fn history(&self) -> Vec<StubEvent> {
        self.history.lock().clone()
    }
}

impl PaymentBackend for StubBackend {
    fn name(&self) -> &'static str {
        "stub"
    }

    fn escrow_bond(&self, agent_id: &str, amount: Amount) -> Result<BondId, PaymentError> {
        let bond_id = BondId(self.next_id("bond"));
        tracing::info!(
            agent = %agent_id,
            cents = amount.cents,
            currency = ?amount.currency,
            id = %bond_id.0,
            "stub: escrow_bond"
        );
        self.history.lock().push(StubEvent::EscrowBond {
            agent_id: agent_id.to_string(),
            amount,
            bond_id: bond_id.clone(),
        });
        Ok(bond_id)
    }

    fn release_bond(&self, bond_id: &BondId) -> Result<(), PaymentError> {
        tracing::info!(id = %bond_id.0, "stub: release_bond");
        self.history.lock().push(StubEvent::ReleaseBond {
            bond_id: bond_id.clone(),
        });
        Ok(())
    }

    fn forfeit_bond(&self, bond_id: &BondId) -> Result<(), PaymentError> {
        tracing::warn!(id = %bond_id.0, "stub: forfeit_bond");
        self.history.lock().push(StubEvent::ForfeitBond {
            bond_id: bond_id.clone(),
        });
        Ok(())
    }

    fn settle_take_rate(&self, split: TakeRateSplit) -> Result<ChargeId, PaymentError> {
        let charge_id = ChargeId(self.next_id("charge"));
        tracing::info!(
            gross = split.gross.cents,
            cut = split.carrier_cut.cents,
            merchant = %split.merchant_account_id,
            id = %charge_id.0,
            "stub: settle_take_rate"
        );
        self.history.lock().push(StubEvent::SettleTakeRate {
            gross: split.gross,
            carrier_cut: split.carrier_cut,
            merchant_account_id: split.merchant_account_id,
            charge_id: charge_id.clone(),
        });
        Ok(charge_id)
    }
}

#[cfg(test)]
mod tests {
    use super::super::Currency;
    use super::*;

    #[test]
    fn escrow_release_flow_records_history() {
        let s = StubBackend::new();
        let bond = s
            .escrow_bond(
                "alpha",
                Amount {
                    cents: 50_000,
                    currency: Currency::Usd,
                },
            )
            .unwrap();
        s.release_bond(&bond).unwrap();
        let h = s.history();
        assert_eq!(h.len(), 2);
    }

    #[test]
    fn forfeit_logs_and_records() {
        let s = StubBackend::new();
        let bond = s.escrow_bond("alpha", Amount::usd(50_000)).unwrap();
        s.forfeit_bond(&bond).unwrap();
        let h = s.history();
        assert!(matches!(h.last().unwrap(), StubEvent::ForfeitBond { .. }));
    }

    #[test]
    fn settle_take_rate_returns_charge_id() {
        let s = StubBackend::new();
        let charge = s
            .settle_take_rate(TakeRateSplit {
                gross: Amount::usd(10_000),
                carrier_cut: Amount::usd(100),
                merchant_account_id: "acct_alpha".into(),
            })
            .unwrap();
        assert!(charge.0.starts_with("stub_charge_"));
    }
}
