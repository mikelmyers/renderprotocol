// Per-agent Ed25519 keypair management (RouteRank step 5c.2).
//
// v0 — single-party signing: the carrier holds keypairs for both itself
// and on-behalf-of every hosting agent it routes to. This is structurally
// honest about v0 (we can't ask MCP servers to adopt a half-baked
// signing extension yet) while putting the verification path in place.
//
// 5c+ migration: when MCP gains a receipt-signing extension and real
// hosting agents start emitting their own signatures, the carrier
// rotates the per-agent private key out of its store and keeps only
// the public key for verification. The schema (`agent_keys.private_key
// NULL`) already accommodates this — see `storage.rs`.
//
// What's signed:
//   - Receipts: bytes = `agent_id || tool || success || latency_ms || ts_ms`.
//     Carrier signs once with the carrier key; on-behalf-of agent signs
//     once with that agent's key. Either signature is sufficient for
//     "this receipt provenance is what we claim" — together they enable
//     the cross-check that fuels the receipt_consistency scoring slot
//     (today returns 1.0; activates when the two-key world arrives).
//   - Vouches: bytes = `voucher_id || vouchee_id || ts_ms`.
//     Signed by the voucher's key.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey, SECRET_KEY_LENGTH};
use parking_lot::RwLock;
use rand::rngs::OsRng;
use std::collections::HashMap;
use std::sync::Arc;

use super::receipts::Receipt;
use super::storage::{Storage, StorageError};
use super::vouches::Vouch;

/// Identifier used for the carrier's own signing key. Receipts get a
/// carrier-side signature in addition to the per-agent signature so a
/// receipt's provenance can be verified even when the agent's key is
/// compromised or rotated.
pub const CARRIER_KEY_ID: &str = "__carrier__";

#[derive(Debug, thiserror::Error)]
pub enum KeyError {
    #[error("storage: {0}")]
    Storage(#[from] StorageError),
    #[error("ed25519: {0}")]
    Signature(#[from] ed25519_dalek::SignatureError),
    #[error("missing private key for agent {0}")]
    MissingPrivateKey(String),
}

/// In-memory cache of every signing/verifying key the carrier knows
/// about. Loaded from `storage.agent_keys` on boot; new agents get a
/// keypair generated and persisted lazily on first use.
pub struct KeyStore {
    storage: Arc<Storage>,
    keys: RwLock<HashMap<String, AgentKeyMaterial>>,
}

#[derive(Clone)]
struct AgentKeyMaterial {
    signing: Option<SigningKey>, // None when only verification is possible
    verifying: VerifyingKey,
}

impl KeyStore {
    pub fn new(storage: Arc<Storage>, now_ms: i64) -> Result<Self, KeyError> {
        let store = Self {
            storage: Arc::clone(&storage),
            keys: RwLock::new(HashMap::new()),
        };
        // Warm the cache with every persisted key so verify paths work
        // without lazy-load round-trips. Skip rows we can't decode —
        // logged but tolerated; means verification fails for that agent
        // and the receipt_consistency slot gets a real signal.
        for (agent_id, stored) in storage.load_all_agent_keys()? {
            let Ok(verifying) = stored
                .public_key
                .as_slice()
                .try_into()
                .map_err(|_| ())
                .and_then(|bytes: [u8; 32]| {
                    VerifyingKey::from_bytes(&bytes).map_err(|_| ())
                })
            else {
                tracing::warn!(agent = %agent_id, "skipping unparseable persisted public key");
                continue;
            };
            let signing = stored
                .private_key
                .as_ref()
                .and_then(|sk| sk.as_slice().try_into().ok())
                .map(|sk: [u8; SECRET_KEY_LENGTH]| SigningKey::from_bytes(&sk));
            store
                .keys
                .write()
                .insert(agent_id, AgentKeyMaterial { signing, verifying });
        }
        // Ensure the carrier's own key exists if we didn't load it.
        let _ = store.ensure_keypair(CARRIER_KEY_ID, now_ms)?;
        Ok(store)
    }

    /// Idempotently ensure a keypair exists for `agent_id`. Loads from
    /// SQLite if present; generates + persists otherwise. Returns the
    /// public key as base64 for telemetry / the carrier_status surface.
    pub fn ensure_keypair(&self, agent_id: &str, now_ms: i64) -> Result<String, KeyError> {
        if let Some(material) = self.keys.read().get(agent_id) {
            return Ok(BASE64.encode(material.verifying.as_bytes()));
        }
        // Try loading from storage.
        if let Some(stored) = self.storage.load_agent_keys(agent_id)? {
            let verifying = VerifyingKey::from_bytes(
                stored
                    .public_key
                    .as_slice()
                    .try_into()
                    .map_err(|_| KeyError::Signature(ed25519_dalek::SignatureError::new()))?,
            )?;
            let signing = stored
                .private_key
                .as_ref()
                .and_then(|sk| sk.as_slice().try_into().ok())
                .map(|sk: [u8; SECRET_KEY_LENGTH]| SigningKey::from_bytes(&sk));
            let material = AgentKeyMaterial { signing, verifying };
            self.keys
                .write()
                .insert(agent_id.to_string(), material.clone());
            return Ok(BASE64.encode(material.verifying.as_bytes()));
        }
        // Generate new.
        let signing = SigningKey::generate(&mut OsRng);
        let verifying = signing.verifying_key();
        self.storage.upsert_agent_keys(
            agent_id,
            verifying.as_bytes(),
            Some(&signing.to_bytes()),
            now_ms,
        )?;
        let material = AgentKeyMaterial {
            signing: Some(signing),
            verifying,
        };
        self.keys
            .write()
            .insert(agent_id.to_string(), material.clone());
        Ok(BASE64.encode(material.verifying.as_bytes()))
    }

    fn sign_with(&self, agent_id: &str, payload: &[u8]) -> Result<Vec<u8>, KeyError> {
        let keys = self.keys.read();
        let material = keys
            .get(agent_id)
            .ok_or_else(|| KeyError::MissingPrivateKey(agent_id.to_string()))?;
        let signing = material
            .signing
            .as_ref()
            .ok_or_else(|| KeyError::MissingPrivateKey(agent_id.to_string()))?;
        Ok(signing.sign(payload).to_bytes().to_vec())
    }

    fn verify_with(&self, agent_id: &str, payload: &[u8], sig_bytes: &[u8]) -> bool {
        let Some(material) = self.keys.read().get(agent_id).cloned() else {
            return false;
        };
        let Ok(sig_arr): Result<[u8; 64], _> = sig_bytes.try_into() else {
            return false;
        };
        let sig = Signature::from_bytes(&sig_arr);
        material.verifying.verify(payload, &sig).is_ok()
    }

    // ---- Receipt signatures --------------------------------------------

    pub fn sign_receipt(
        &self,
        r: &Receipt,
        now_ms: i64,
    ) -> Result<(Vec<u8>, Vec<u8>), KeyError> {
        // Lazy: ensure both keys exist (carrier always; agent lazily).
        self.ensure_keypair(&r.agent_id, now_ms)?;
        let payload = receipt_payload(r);
        let carrier_sig = self.sign_with(CARRIER_KEY_ID, &payload)?;
        let agent_sig = self.sign_with(&r.agent_id, &payload)?;
        Ok((carrier_sig, agent_sig))
    }

    /// True iff both signatures verify against their declared keys.
    /// `carrier_sig` and `agent_sig` are bytes as stored in
    /// `storage.receipts`. Used during hydration on boot — receipts
    /// that fail verification are quarantined (excluded from the
    /// in-memory store and the receipt_consistency slot fires).
    pub fn verify_receipt(
        &self,
        r: &Receipt,
        carrier_sig: Option<&[u8]>,
        agent_sig: Option<&[u8]>,
    ) -> bool {
        let payload = receipt_payload(r);
        let carrier_ok = carrier_sig
            .map(|s| self.verify_with(CARRIER_KEY_ID, &payload, s))
            .unwrap_or(false);
        let agent_ok = agent_sig
            .map(|s| self.verify_with(&r.agent_id, &payload, s))
            .unwrap_or(false);
        carrier_ok && agent_ok
    }

    // ---- Vouch signatures ----------------------------------------------

    pub fn sign_vouch(&self, v: &Vouch, now_ms: i64) -> Result<Vec<u8>, KeyError> {
        self.ensure_keypair(&v.voucher_id, now_ms)?;
        let payload = vouch_payload(v);
        self.sign_with(&v.voucher_id, &payload)
    }

    pub fn verify_vouch(&self, v: &Vouch, signature: &[u8]) -> bool {
        let payload = vouch_payload(v);
        self.verify_with(&v.voucher_id, &payload, signature)
    }
}

fn receipt_payload(r: &Receipt) -> Vec<u8> {
    let mut buf = Vec::with_capacity(r.agent_id.len() + r.tool.len() + 32);
    buf.extend_from_slice(r.agent_id.as_bytes());
    buf.push(0);
    buf.extend_from_slice(r.tool.as_bytes());
    buf.push(0);
    buf.push(if r.success { 1 } else { 0 });
    buf.extend_from_slice(&r.latency_ms.to_be_bytes());
    buf.extend_from_slice(&r.ts_ms.to_be_bytes());
    // Exploratory and error_kind intentionally NOT in the signed payload —
    // they're carrier-side derived metadata, not part of the canonical
    // call provenance. The agent shouldn't have to attest to whether the
    // carrier classified the call as exploratory.
    buf
}

fn vouch_payload(v: &Vouch) -> Vec<u8> {
    let mut buf =
        Vec::with_capacity(v.voucher_id.len() + v.vouchee_id.len() + 8);
    buf.extend_from_slice(v.voucher_id.as_bytes());
    buf.push(0);
    buf.extend_from_slice(v.vouchee_id.as_bytes());
    buf.push(0);
    buf.extend_from_slice(&v.ts_ms.to_be_bytes());
    buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::carrier::receipts::Receipt;

    fn setup() -> KeyStore {
        let storage = Arc::new(Storage::in_memory().unwrap());
        KeyStore::new(storage, 1000).unwrap()
    }

    fn r(agent: &str) -> Receipt {
        Receipt {
            agent_id: agent.into(),
            tool: "lookup".into(),
            success: true,
            latency_ms: 30,
            ts_ms: 12345,
            error_kind: None,
            exploratory: false,
        }
    }

    #[test]
    fn carrier_key_exists_at_boot() {
        let ks = setup();
        // No panic = carrier key was generated and cached.
        let pk = ks.ensure_keypair(CARRIER_KEY_ID, 0).unwrap();
        assert!(!pk.is_empty());
    }

    #[test]
    fn receipt_sign_and_verify_round_trip() {
        let ks = setup();
        let receipt = r("alpha");
        let (carrier_sig, agent_sig) = ks.sign_receipt(&receipt, 1000).unwrap();
        assert!(ks.verify_receipt(&receipt, Some(&carrier_sig), Some(&agent_sig)));
    }

    #[test]
    fn receipt_verify_fails_on_tamper() {
        let ks = setup();
        let receipt = r("alpha");
        let (carrier_sig, agent_sig) = ks.sign_receipt(&receipt, 1000).unwrap();
        let tampered = Receipt {
            ts_ms: 99999, // changed
            ..receipt
        };
        assert!(!ks.verify_receipt(&tampered, Some(&carrier_sig), Some(&agent_sig)));
    }

    #[test]
    fn vouch_sign_and_verify_round_trip() {
        let ks = setup();
        ks.ensure_keypair("alpha", 1000).unwrap();
        let v = Vouch {
            voucher_id: "alpha".into(),
            vouchee_id: "beta".into(),
            ts_ms: 5000,
            revoked_at_ms: None,
            signature: None,
        };
        let sig = ks.sign_vouch(&v, 1000).unwrap();
        assert!(ks.verify_vouch(&v, &sig));
    }

    #[test]
    fn keypair_persists_across_keystore_reopen() {
        let storage = Arc::new(Storage::in_memory().unwrap());
        let ks1 = KeyStore::new(Arc::clone(&storage), 1000).unwrap();
        let pk1 = ks1.ensure_keypair("alpha", 1000).unwrap();
        // Drop ks1; new KeyStore on same storage should load the existing key.
        drop(ks1);
        let ks2 = KeyStore::new(storage, 2000).unwrap();
        let pk2 = ks2.ensure_keypair("alpha", 2000).unwrap();
        assert_eq!(pk1, pk2);
    }
}
