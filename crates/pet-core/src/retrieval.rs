use crate::facts::{Fact, Lang};

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
    "does", "and", "to", "in", "please",
];

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
    let q = normalize(question, lang);
    if q.is_empty() {
        return None;
    }
    facts
        .iter()
        .filter(|f| f.public)
        .map(|fact| Match {
            fact,
            score: score(fact, &q, lang),
        })
        .filter(|m| m.score >= min_score)
        .max_by(|a, b| a.score.total_cmp(&b.score))
}

fn score(fact: &Fact, q: &[String], lang: Lang) -> f32 {
    let mut total = 0.0f32;
    for kw in fact.keywords.get(lang) {
        for k in normalize(kw, lang) {
            let best = q
                .iter()
                .map(|w| strsim::jaro_winkler(w, &k))
                .fold(0.0f64, f64::max);
            // Tune this threshold against the eval set (typos vs false positives).
            if best >= 0.92 {
                total += best as f32;
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
}
