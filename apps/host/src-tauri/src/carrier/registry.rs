// Hosting agent registry. Parses `config/hosting-agents.md` into a list
// of HostingAgentSpec records the carrier connects to at boot.
//
// Re-uses crate::config_parser to split the markdown into sections; each
// `## ` section is one agent. Body lines are simple `key: value` pairs.
// Required: `endpoint`. Optional: `description`.
//
// v0: registry is read once at boot. Hot-reload of agent additions /
// removals at runtime is a follow-up — graceful tear-down of in-flight
// sessions makes that non-trivial.

use std::path::Path;

use crate::config_parser;

#[derive(Debug, Clone)]
pub struct HostingAgentSpec {
    pub id: String,
    pub endpoint: String,
    pub description: Option<String>,
}

pub fn load_from_path(path: &Path) -> Result<Vec<HostingAgentSpec>, String> {
    let contents = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(parse(&contents))
}

pub fn parse(contents: &str) -> Vec<HostingAgentSpec> {
    let doc = config_parser::parse(contents);
    doc.sections
        .into_iter()
        .filter_map(|section| {
            let endpoint = extract_kv(&section.body, "endpoint")?;
            Some(HostingAgentSpec {
                id: section.heading,
                endpoint,
                description: extract_kv(&section.body, "description"),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_two_agents() {
        let input = "# Hosting Agents\n\n## alpha\nendpoint: http://127.0.0.1:4717/mcp\ndescription: First.\n\n## beta\nendpoint: http://127.0.0.1:4718/mcp\n";
        let v = parse(input);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].id, "alpha");
        assert_eq!(v[0].endpoint, "http://127.0.0.1:4717/mcp");
        assert_eq!(v[0].description.as_deref(), Some("First."));
        assert_eq!(v[1].id, "beta");
        assert!(v[1].description.is_none());
    }

    #[test]
    fn skips_sections_without_endpoint() {
        let input = "## broken\ndescription: missing endpoint";
        assert!(parse(input).is_empty());
    }

    #[test]
    fn empty_input_yields_no_agents() {
        assert!(parse("").is_empty());
    }
}
