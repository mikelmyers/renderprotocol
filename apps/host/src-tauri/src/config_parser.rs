// Pragmatic markdown section parser for `agent.md` / `user.md` files.
//
// The contract is loose by design: the surface trusts the human who wrote
// the file. We extract:
//   - the H1 title (if any) as the document name
//   - each H2 heading as a section, with the body text below it (until the
//     next H2 or end of document) preserved verbatim
//   - a small typed view for known sections (Defaults, Permissions, Carriers,
//     Audit, Standing concerns) that the composer cares about
//
// Sections we don't recognize are still surfaced via the `sections` map so
// future composer rules can read them without changing the parser. Heavier
// schemas (front-matter, YAML) are deferred — the right moment for those is
// when a real consumer of the structured data demands them.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ParsedDoc {
    pub title: Option<String>,
    /// Heading text → section body, preserved in document order.
    pub sections: Vec<Section>,
    /// Convenience map for lookup by lowercased heading.
    pub sections_by_key: BTreeMap<String, String>,
    /// Known typed slices the composer reads directly.
    pub typed: TypedView,
    /// Full original text. Hot-reload UIs may render this verbatim.
    pub raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub heading: String,
    pub body: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TypedView {
    /// Bullet items under "Defaults".
    pub defaults: Vec<String>,
    /// Bullet items under "Standing concerns".
    pub standing_concerns: Vec<String>,
    /// Permissions rules — each line normalized as `kind: rule`.
    pub permissions: Vec<String>,
    /// Carrier directives — each line normalized.
    pub carriers: Vec<String>,
    /// Audit policy bullets.
    pub audit: Vec<String>,
}

pub fn parse(text: &str) -> ParsedDoc {
    let mut doc = ParsedDoc {
        raw: text.to_string(),
        ..ParsedDoc::default()
    };

    let mut current_heading: Option<String> = None;
    let mut current_body: Vec<&str> = Vec::new();
    let mut flush = |heading: Option<String>, body: Vec<&str>, doc: &mut ParsedDoc| {
        if let Some(h) = heading {
            let body_text = body.join("\n").trim_end_matches('\n').to_string();
            doc.sections_by_key
                .insert(h.to_lowercase(), body_text.clone());
            doc.sections.push(Section {
                heading: h,
                body: body_text,
            });
        }
    };

    for line in text.lines() {
        let trimmed = line.trim_end();
        if let Some(rest) = trimmed.strip_prefix("# ") {
            // H1 — document title. Only the first one wins; subsequent
            // H1s are unlikely in well-formed docs but tolerated as
            // section content if they appear.
            if doc.title.is_none() {
                doc.title = Some(rest.trim().to_string());
                continue;
            }
        }
        if let Some(rest) = trimmed.strip_prefix("## ") {
            // Close out the previous section, start a new one.
            flush(current_heading.take(), std::mem::take(&mut current_body), &mut doc);
            current_heading = Some(rest.trim().to_string());
            continue;
        }
        if current_heading.is_some() {
            current_body.push(line);
        }
    }
    flush(current_heading.take(), current_body, &mut doc);

    // Build the typed view from known sections.
    doc.typed.defaults = bullets(&doc, "defaults");
    doc.typed.standing_concerns = bullets(&doc, "standing concerns");
    doc.typed.permissions = bullets(&doc, "permissions");
    doc.typed.carriers = bullets(&doc, "carriers");
    doc.typed.audit = bullets(&doc, "audit");

    doc
}

fn bullets(doc: &ParsedDoc, key: &str) -> Vec<String> {
    let Some(body) = doc.sections_by_key.get(key) else {
        return Vec::new();
    };
    body.lines()
        .map(str::trim)
        .filter(|l| l.starts_with("- ") || l.starts_with("* "))
        .map(|l| l.trim_start_matches(['-', '*']).trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_title_and_sections() {
        let text = "# My Agent\n\n## Defaults\n- a\n- b\n\n## Permissions\n- read: all\n";
        let doc = parse(text);
        assert_eq!(doc.title.as_deref(), Some("My Agent"));
        assert_eq!(doc.typed.defaults, vec!["a", "b"]);
        assert_eq!(doc.typed.permissions, vec!["read: all"]);
    }

    #[test]
    fn keeps_unknown_sections() {
        let text = "## Whatever\nbody\n";
        let doc = parse(text);
        assert!(doc.sections_by_key.contains_key("whatever"));
    }
}
