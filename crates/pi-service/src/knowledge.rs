//! The facts the pet may state and the per-language prompt prefixes.
//!
//! By default both are compiled into the binary (`include_str!`), so the Pi needs only the
//! one executable and the prefix bytes can never drift between requests (llama.cpp reuses
//! its KV cache only while the start of the prompt is byte-identical). Set `DATA_DIR` to a
//! checkout's `data/` folder to load edited files without rebuilding.

use std::{fs, path::Path};

use pet_core::{parse_facts, Fact, Lang};

const FACTS_JSON: &str = include_str!("../../../data/facts.json");
const PREFIX_ID: &str = include_str!("../../../data/prompts/prefix.id.txt");
const PREFIX_EN: &str = include_str!("../../../data/prompts/prefix.en.txt");

pub struct Knowledge {
    pub facts: Vec<Fact>,
    prefix_id: String,
    prefix_en: String,
}

impl Knowledge {
    pub fn embedded() -> Result<Self, String> {
        Self::build(FACTS_JSON, PREFIX_ID, PREFIX_EN)
    }

    /// Load `facts.json` and `prompts/prefix.{id,en}.txt` from a `data/`-style folder.
    pub fn from_dir(dir: &Path) -> Result<Self, String> {
        let read = |rel: &str| {
            let path = dir.join(rel);
            fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
        };
        Self::build(
            &read("facts.json")?,
            &read("prompts/prefix.id.txt")?,
            &read("prompts/prefix.en.txt")?,
        )
    }

    fn build(facts_json: &str, prefix_id: &str, prefix_en: &str) -> Result<Self, String> {
        let facts = parse_facts(facts_json).map_err(|e| format!("facts.json: {e}"))?;
        if !facts.iter().any(|f| f.public) {
            return Err("facts.json has no public facts, so the pet could never answer".into());
        }
        if prefix_id.trim().is_empty() || prefix_en.trim().is_empty() {
            return Err("a prompt prefix file is empty".into());
        }
        Ok(Self {
            facts,
            prefix_id: prefix_id.to_string(),
            prefix_en: prefix_en.to_string(),
        })
    }

    /// The static prompt start for this language, exactly as written in the file.
    pub fn prefix(&self, lang: Lang) -> &str {
        match lang {
            Lang::Id => &self.prefix_id,
            Lang::En => &self.prefix_en,
        }
    }

    pub fn public_count(&self) -> usize {
        self.facts.iter().filter(|f| f.public).count()
    }

    #[cfg(test)]
    pub fn fact(&self, id: &str) -> Option<&Fact> {
        self.facts.iter().find(|f| f.id == id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_FACT: &str = r#"[{"id":"f","about":"club","public":PUBLIC,
        "keywords":{"id":["x"],"en":["x"]},
        "text":{"id":"t","en":"t"},"fallback_line":{"id":"f","en":"f"}}]"#;

    fn one_fact(public: bool) -> String {
        ONE_FACT.replace("PUBLIC", &public.to_string())
    }

    #[test]
    fn embedded_data_loads_and_has_public_facts() {
        let k = Knowledge::embedded().expect("embedded data must be valid");
        assert!(k.public_count() > 0);
        assert!(k.fact("club.intro").is_some());
        assert_ne!(k.prefix(Lang::Id), k.prefix(Lang::En));
    }

    #[test]
    fn rejects_a_facts_file_with_nothing_public() {
        assert!(Knowledge::build(&one_fact(false), "p", "p").is_err());
        assert!(Knowledge::build(&one_fact(true), "p", "p").is_ok());
    }

    #[test]
    fn rejects_empty_prefixes_and_bad_json() {
        assert!(Knowledge::build(&one_fact(true), "  \n", "p").is_err());
        assert!(Knowledge::build(&one_fact(true), "p", "").is_err());
        assert!(Knowledge::build("not json", "p", "p").is_err());
    }

    #[test]
    fn prefix_is_returned_byte_for_byte() {
        let k = Knowledge::build(&one_fact(true), "ID prefix\n", "EN prefix\n").unwrap();
        assert_eq!(k.prefix(Lang::Id), "ID prefix\n");
        assert_eq!(k.prefix(Lang::En), "EN prefix\n");
    }

    #[test]
    fn from_dir_reports_the_missing_file() {
        let err = Knowledge::from_dir(Path::new("/definitely/not/here"))
            .err()
            .expect("must fail");
        assert!(err.contains("facts.json"), "{err}");
    }
}
