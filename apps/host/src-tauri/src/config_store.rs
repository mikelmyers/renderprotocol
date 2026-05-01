// In-memory store for parsed `user.md` and `agent.md` documents, plus the
// "active agent" selection. Keyed by filename stem for agents
// (`primordia-ops`, `personal`) and a single slot for the user document.
//
// The store is the single source of truth that Tauri commands and the
// watcher both touch. Writers update the parsed doc; readers grab a clone
// so the lock is never held across IPC.

use std::collections::BTreeMap;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

use crate::config_parser::{parse, ParsedDoc};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConfigKind {
    User,
    Agent,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigSnapshot {
    pub user: Option<ParsedDoc>,
    pub agents: BTreeMap<String, ParsedDoc>,
    pub active_agent: Option<String>,
}

#[derive(Default)]
struct Inner {
    user: Option<ParsedDoc>,
    agents: BTreeMap<String, ParsedDoc>,
    active_agent: Option<String>,
}

pub struct ConfigStore {
    inner: RwLock<Inner>,
}

impl ConfigStore {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(Inner::default()),
        }
    }

    pub fn upsert(&self, kind: ConfigKind, key: &str, text: &str) {
        let parsed = parse(text);
        let mut g = self.inner.write();
        match kind {
            ConfigKind::User => g.user = Some(parsed),
            ConfigKind::Agent => {
                g.agents.insert(key.to_string(), parsed);
                if g.active_agent.is_none() {
                    g.active_agent = Some(key.to_string());
                }
            }
        }
    }

    pub fn remove(&self, kind: &ConfigKind, key: &str) {
        let mut g = self.inner.write();
        match kind {
            ConfigKind::User => g.user = None,
            ConfigKind::Agent => {
                g.agents.remove(key);
                if g.active_agent.as_deref() == Some(key) {
                    // Choose another agent if any remain — keeps the
                    // surface useful when the active file is renamed.
                    g.active_agent = g.agents.keys().next().cloned();
                }
            }
        }
    }

    pub fn snapshot(&self) -> ConfigSnapshot {
        let g = self.inner.read();
        ConfigSnapshot {
            user: g.user.clone(),
            agents: g.agents.clone(),
            active_agent: g.active_agent.clone(),
        }
    }

    pub fn set_active_agent(&self, key: &str) -> bool {
        let mut g = self.inner.write();
        if g.agents.contains_key(key) {
            g.active_agent = Some(key.to_string());
            true
        } else {
            false
        }
    }
}
