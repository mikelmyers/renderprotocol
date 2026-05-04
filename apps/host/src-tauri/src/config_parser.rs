// Markdown config parser for `agent.md` and `user.md`.
//
// v0 surface needs: the document's title (first H1) and its sections
// (split by `## ` headings). Sections carry verbatim markdown bodies that
// the React side renders via react-markdown. We don't render markdown in
// Rust — that's the frontend's job.
//
// Parser is intentionally tiny: any text input parses successfully. There
// is no malformed-input error path because there is no schema we enforce.
// A file with no headings yields title=None, sections=[], body=raw.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ParsedDocument {
    /// First H1 heading text, if any.
    pub title: Option<String>,
    /// Verbatim markdown body. The frontend renders this via react-markdown.
    pub body: String,
    /// H2-delimited sections in document order.
    pub sections: Vec<Section>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Section {
    pub heading: String,
    /// Verbatim markdown for the section content (between this heading and
    /// the next H2 or end of document). Heading line itself is excluded.
    pub body: String,
}

/// Parse a markdown config document. Always succeeds.
pub fn parse(contents: &str) -> ParsedDocument {
    let mut title: Option<String> = None;
    let mut sections: Vec<Section> = Vec::new();
    let mut current: Option<(String, Vec<&str>)> = None;

    for line in contents.lines() {
        if title.is_none() {
            if let Some(rest) = line.strip_prefix("# ") {
                title = Some(rest.trim().to_string());
                continue;
            }
        }
        if let Some(rest) = line.strip_prefix("## ") {
            if let Some((heading, body_lines)) = current.take() {
                sections.push(Section {
                    heading,
                    body: body_lines.join("\n").trim_end().to_string(),
                });
            }
            current = Some((rest.trim().to_string(), Vec::new()));
        } else if let Some((_, ref mut body_lines)) = current {
            body_lines.push(line);
        }
    }

    if let Some((heading, body_lines)) = current.take() {
        sections.push(Section {
            heading,
            body: body_lines.join("\n").trim_end().to_string(),
        });
    }

    ParsedDocument {
        title,
        body: contents.to_string(),
        sections,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_parses_to_empty_doc() {
        let p = parse("");
        assert!(p.title.is_none());
        assert!(p.sections.is_empty());
        assert_eq!(p.body, "");
    }

    #[test]
    fn no_headings_keeps_body_only() {
        let p = parse("just a line\nand another");
        assert!(p.title.is_none());
        assert!(p.sections.is_empty());
        assert_eq!(p.body, "just a line\nand another");
    }

    #[test]
    fn extracts_title_and_sections() {
        let input = "# Agent Name\n\n## Purpose\nDo good.\n\n## Defaults\n- Be calm.\n";
        let p = parse(input);
        assert_eq!(p.title.as_deref(), Some("Agent Name"));
        assert_eq!(p.sections.len(), 2);
        assert_eq!(p.sections[0].heading, "Purpose");
        assert!(p.sections[0].body.contains("Do good."));
        assert_eq!(p.sections[1].heading, "Defaults");
        assert!(p.sections[1].body.contains("- Be calm."));
    }

    #[test]
    fn second_h1_is_not_treated_as_title() {
        let p = parse("# First\n\n# Second\n");
        assert_eq!(p.title.as_deref(), Some("First"));
    }

    #[test]
    fn content_before_first_h2_after_title_is_dropped_from_sections() {
        // v0 behavior: only H2-introduced text becomes a section. Preamble
        // between H1 and the first H2 lives only in `body`. Worth knowing
        // when designing config templates.
        let p = parse("# Title\n\nSome preamble.\n\n## First Section\nbody\n");
        assert_eq!(p.sections.len(), 1);
        assert!(p.body.contains("Some preamble."));
    }
}
