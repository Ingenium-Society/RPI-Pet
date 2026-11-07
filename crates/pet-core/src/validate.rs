use crate::facts::{Fact, Lang};

/// A 270M model must never break character. If any of these show up, the answer is rejected.
pub const BANNED_PHRASES: &[&str] = &[
    "language model",
    "model bahasa",
    "large language",
    "as an ai",
    "sebagai ai",
    "sebagai model",
    "ai assistant",
    "asisten ai",
    "openai",
    "chatgpt",
    "gemma",
    "smollm",
    "llama",
];

pub const MIN_ANSWER_CHARS: usize = 3;
pub const MAX_ANSWER_CHARS: usize = 300;

/// An answer is grounded when it is a sane length, never breaks character, and contains
/// every `must_contain` anchor of the fact (case-insensitive). Empty `must_contain` means
/// only the length and banned-phrase checks apply.
pub fn validate_answer(fact: &Fact, answer: &str) -> bool {
    let trimmed = answer.trim();
    let len = trimmed.chars().count();
    if !(MIN_ANSWER_CHARS..=MAX_ANSWER_CHARS).contains(&len) {
        return false;
    }
    let lower = trimmed.to_lowercase();
    if BANNED_PHRASES.iter().any(|b| lower.contains(b)) {
        return false;
    }
    fact.must_contain
        .iter()
        .all(|m| lower.contains(&m.to_lowercase()))
}

/// Pre-written reply used when retrieval finds no fact. Pet voice, no model involved.
pub fn no_match_line(lang: Lang) -> &'static str {
    match lang {
        Lang::Id => "Hmm, aku belum tahu soal itu. Coba tanya tentang klub Ingenium, proyek kami, atau siapa yang membuatku!",
        Lang::En => "Hmm, I don't know about that yet. Try asking about the Ingenium club, our projects, or who made me!",
    }
}

/// What to show the visitor, and where it came from (so the interaction log can record it).
#[derive(Debug, PartialEq, Eq)]
pub struct Grounded {
    pub text: String,
    pub from_model: bool,
}

/// Use the model's answer if it validates, otherwise the fact's `fallback_line`.
pub fn ground(fact: &Fact, lang: Lang, model_answer: Option<&str>) -> Grounded {
    match model_answer {
        Some(a) if validate_answer(fact, a) => Grounded {
            text: a.trim().to_string(),
            from_model: true,
        },
        _ => Grounded {
            text: fact.fallback_line.get(lang).clone(),
            from_model: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facts::parse_facts;

    fn fact(must: &str) -> Fact {
        parse_facts(&format!(
            r#"[{{"id":"f","about":"club","public":true,
               "keywords":{{"id":["x"],"en":["x"]}},
               "text":{{"id":"x","en":"x"}},
               "fallback_line":{{"id":"fb-id","en":"fb-en"}},
               "must_contain":{must}}}]"#
        ))
        .unwrap()
        .remove(0)
    }

    #[test]
    fn accepts_grounded_answer() {
        assert!(validate_answer(&fact(r#"["26"]"#), "There are 26 of us!"));
    }

    #[test]
    fn rejects_missing_anchor() {
        assert!(!validate_answer(&fact(r#"["26"]"#), "Lots of us!"));
    }

    #[test]
    fn all_anchors_are_required() {
        let f = fact(r#"["Haidar","Rizky"]"#);
        assert!(validate_answer(&f, "Made by haidar and RIZKY!"));
        assert!(!validate_answer(&f, "Made by Haidar!"));
    }

    #[test]
    fn rejects_breaking_character() {
        assert!(!validate_answer(
            &fact("[]"),
            "I am a pet, but really a large language model."
        ));
        assert!(!validate_answer(&fact("[]"), "Aku adalah model bahasa."));
    }

    #[test]
    fn rejects_empty_and_runaway_answers() {
        assert!(!validate_answer(&fact("[]"), "  "));
        assert!(!validate_answer(&fact("[]"), &"la ".repeat(200)));
    }

    #[test]
    fn empty_must_contain_still_checks_banned_phrases() {
        assert!(validate_answer(&fact("[]"), "I'm a virtual pet!"));
    }

    #[test]
    fn ground_falls_back_on_bad_or_missing_answer() {
        let f = fact(r#"["26"]"#);
        assert_eq!(
            ground(&f, Lang::En, Some("26 of us")),
            Grounded {
                text: "26 of us".into(),
                from_model: true
            }
        );
        assert_eq!(ground(&f, Lang::Id, Some("banyak")).text, "fb-id");
        assert!(!ground(&f, Lang::En, None).from_model);
    }
}
