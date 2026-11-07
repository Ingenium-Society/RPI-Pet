use crate::facts::{Fact, Lang};
use std::collections::{HashMap, HashSet};

const STOP_ID: &[&str] = &[
    "apa",
    "siapa",
    "yang",
    "kamu",
    "dia",
    "itu",
    "ini",
    "di",
    "dan",
    "dari",
    "ke",
    "adalah",
    "tentang",
    "ceritakan",
    "tolong",
    "dong",
    "sih",
    "ya",
];
const STOP_EN: &[&str] = &[
    "what", "who", "is", "are", "the", "a", "an", "of", "about", "tell", "me", "you", "your", "do",
    "does", "and", "to", "in", "please", "this", "that", "there", "it",
];

/// Words that appear in almost every question about this club. They only count when nothing
/// more specific is left, so "who leads the club?" scores on "leads", not on "club".
const DOMAIN_ID: &[&str] = &["klub"];
const DOMAIN_EN: &[&str] = &["club"];

/// Minimum retrieval score. A hit on a keyword unique to one fact scores about 1.0; hits on
/// keywords shared by n facts score about 1/n each.
/// The sweep is flat from 0.5 to 1.0 on `data/eval/questions.json` (synthetic), so 0.75 is the
/// middle of that plateau. Re-run the sweep
/// (`cargo test -p pet-core -- --ignored --nocapture sweep`) with real visitor questions.
pub const MIN_SCORE: f32 = 0.75;

/// Lowercase, split on non-alphanumerics, drop stopwords, strip a few Indonesian suffixes.
pub fn normalize(input: &str, lang: Lang) -> Vec<String> {
    let stop = match lang {
        Lang::Id => STOP_ID,
        Lang::En => STOP_EN,
    };
    input
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty() && !stop.contains(w))
        .map(|w| strip_affix(w, lang))
        .collect()
}

/// Lowercase and split on non-alphanumerics, keeping every word (stopwords included).
fn raw_tokens(input: &str) -> Vec<String> {
    input
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

/// Normalized keyword tokens; a keyword made only of stopwords (e.g. "who are you") keeps its raw words.
fn keyword_tokens(kw: &str, lang: Lang) -> Vec<String> {
    let keys = normalize(kw, lang);
    if keys.is_empty() {
        raw_tokens(kw)
    } else {
        keys
    }
}

/// In how many public facts does each keyword token appear? A token shared by several facts
/// says little about which one the visitor means, so its hits are weighted by 1/df.
fn doc_freq(facts: &[Fact], lang: Lang) -> HashMap<String, usize> {
    let mut df = HashMap::new();
    for fact in facts.iter().filter(|f| f.public) {
        let tokens: HashSet<String> = fact
            .keywords
            .get(lang)
            .iter()
            .flat_map(|kw| keyword_tokens(kw, lang))
            .collect();
        for t in tokens {
            *df.entry(t).or_insert(0) += 1;
        }
    }
    df
}

fn strip_affix(w: &str, lang: Lang) -> String {
    if lang == Lang::Id {
        for suf in ["nya", "mu", "ku"] {
            if w.chars().count() > suf.len() + 2 {
                if let Some(stem) = w.strip_suffix(suf) {
                    return stem.to_string();
                }
            }
        }
    }
    w.to_string()
}

#[derive(Debug)]
pub struct Match<'a> {
    pub fact: &'a Fact,
    pub score: f32,
}

/// Best public fact for a question, or None if nothing scores at least `min_score`.
/// Keywords are normalized the same way as the question, so both sides stay consistent.
pub fn retrieve<'a>(
    facts: &'a [Fact],
    question: &str,
    lang: Lang,
    min_score: f32,
) -> Option<Match<'a>> {
    let mut q = normalize(question, lang);
    if q.is_empty() {
        // "Who are you?" is all stopwords. Fall back to raw words so identity questions can
        // still match keywords like "who are you".
        q = raw_tokens(question);
    }
    let domain = match lang {
        Lang::Id => DOMAIN_ID,
        Lang::En => DOMAIN_EN,
    };
    let specific: Vec<String> = q
        .iter()
        .filter(|w| !domain.contains(&w.as_str()))
        .cloned()
        .collect();
    if !specific.is_empty() {
        q = specific;
    }
    if q.is_empty() {
        return None;
    }
    let df = doc_freq(facts, lang);
    facts
        .iter()
        .filter(|f| f.public)
        .map(|fact| Match {
            fact,
            score: score(fact, &q, lang, &df),
        })
        .filter(|m| m.score >= min_score)
        .max_by(|a, b| {
            // Equal scores: prefer the more focused fact (fewer keywords), so the winner
            // never depends on the order of facts in the file.
            a.score.total_cmp(&b.score).then_with(|| {
                b.fact
                    .keywords
                    .get(lang)
                    .len()
                    .cmp(&a.fact.keywords.get(lang).len())
            })
        })
}

fn score(fact: &Fact, q: &[String], lang: Lang, df: &HashMap<String, usize>) -> f32 {
    let mut total = 0.0f32;
    for kw in fact.keywords.get(lang) {
        for k in keyword_tokens(kw, lang) {
            let best = q
                .iter()
                .map(|w| strsim::jaro_winkler(w, &k))
                .fold(0.0f64, f64::max);
            // Tune this threshold against the eval set (typos vs false positives).
            if best >= 0.92 {
                let shared = df.get(&k).copied().unwrap_or(1).max(1) as f32;
                total += best as f32 / shared;
            }
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facts::parse_facts;

    fn facts() -> Vec<Fact> {
        parse_facts(
            r#"[
              {"id":"club","about":"club","public":true,
               "keywords":{"id":["klub","robotik"],"en":["club","robotics"]},
               "text":{"id":"x","en":"x"},"fallback_line":{"id":"x","en":"x"}},
              {"id":"hidden","about":"me","public":false,
               "keywords":{"id":["rahasia"],"en":["secret"]},
               "text":{"id":"x","en":"x"},"fallback_line":{"id":"x","en":"x"}}
            ]"#,
        )
        .unwrap()
    }

    #[test]
    fn matches_indonesian() {
        let f = facts();
        let m = retrieve(&f, "Ceritakan tentang klub kamu dong", Lang::Id, 0.9).unwrap();
        assert_eq!(m.fact.id, "club");
    }

    #[test]
    fn matches_english() {
        let f = facts();
        let m = retrieve(&f, "Tell me about the club", Lang::En, 0.9).unwrap();
        assert_eq!(m.fact.id, "club");
    }

    #[test]
    fn tolerates_typos() {
        let f = facts();
        assert!(retrieve(&f, "robotiks", Lang::En, 0.9).is_some());
    }

    #[test]
    fn unrelated_question_deflects() {
        let f = facts();
        assert!(retrieve(&f, "what's the weather", Lang::En, 0.9).is_none());
    }

    #[test]
    fn private_facts_are_never_returned() {
        let f = facts();
        assert!(retrieve(&f, "secret", Lang::En, 0.9).is_none());
    }

    #[test]
    fn identity_question_made_only_of_stopwords_still_matches() {
        let f = parse_facts(
            r#"[{"id":"self","about":"pet","public":true,
               "keywords":{"id":["kamu siapa"],"en":["who are you"]},
               "text":{"id":"x","en":"x"},"fallback_line":{"id":"x","en":"x"}}]"#,
        )
        .unwrap();
        assert!(retrieve(&f, "Who are you?", Lang::En, 0.9).is_some());
        assert!(retrieve(&f, "Kamu siapa?", Lang::Id, 0.9).is_some());
    }

    #[test]
    fn generic_domain_word_does_not_beat_a_specific_one() {
        let f = parse_facts(
            r#"[{"id":"club","about":"club","public":true,
               "keywords":{"id":["klub"],"en":["club"]},
               "text":{"id":"x","en":"x"},"fallback_line":{"id":"x","en":"x"}},
              {"id":"leader","about":"club","public":true,
               "keywords":{"id":["ketua"],"en":["leader"]},
               "text":{"id":"x","en":"x"},"fallback_line":{"id":"x","en":"x"}}]"#,
        )
        .unwrap();
        let m = retrieve(&f, "Who is the leader of the club?", Lang::En, 0.9).unwrap();
        assert_eq!(m.fact.id, "leader");
        let m = retrieve(&f, "Tell me about the club", Lang::En, 0.9).unwrap();
        assert_eq!(m.fact.id, "club");
    }

    #[test]
    fn tie_goes_to_the_more_focused_fact_regardless_of_order() {
        let broad = r#"{"id":"broad","about":"club","public":true,
            "keywords":{"id":["a","b","c"],"en":["alpha","beta","gamma"]},
            "text":{"id":"x","en":"x"},"fallback_line":{"id":"x","en":"x"}}"#;
        let focused = r#"{"id":"focused","about":"club","public":true,
            "keywords":{"id":["a"],"en":["alpha"]},
            "text":{"id":"x","en":"x"},"fallback_line":{"id":"x","en":"x"}}"#;
        for order in [
            format!("[{broad},{focused}]"),
            format!("[{focused},{broad}]"),
        ] {
            let f = parse_facts(&order).unwrap();
            // "alpha" is shared, so both score the same; the tie-break decides.
            let m = retrieve(&f, "alpha", Lang::En, 0.1).unwrap();
            assert_eq!(m.fact.id, "focused");
        }
    }
}
