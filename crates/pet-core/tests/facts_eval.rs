//! Checks the real `data/facts.json` and tunes retrieval against `data/eval/questions.json`.
//!
//! Run the threshold sweep with:
//!   cargo test -p pet-core -- --ignored --nocapture sweep

use pet_core::{detect_lang, load_facts, retrieve, validate_answer, Fact, Lang, MIN_SCORE};
use serde_json::Value;
use std::path::PathBuf;

fn data(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../data")
        .join(path)
}

fn facts() -> Vec<Fact> {
    load_facts(data("facts.json")).expect("data/facts.json must parse")
}

struct Q {
    q: String,
    lang: Lang,
    expect: Option<String>,
}

fn questions() -> Vec<Q> {
    let raw = std::fs::read_to_string(data("eval/questions.json")).unwrap();
    let v: Value = serde_json::from_str(&raw).unwrap();
    v["questions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| Q {
            q: i["q"].as_str().unwrap().to_string(),
            lang: match i["lang"].as_str().unwrap() {
                "id" => Lang::Id,
                _ => Lang::En,
            },
            expect: i["expect"].as_str().map(str::to_string),
        })
        .collect()
}

fn lookup(facts: &[Fact], q: &Q, min_score: f32) -> Option<String> {
    let lang = detect_lang(&q.q);
    retrieve(facts, &q.q, lang, min_score).map(|m| m.fact.id.clone())
}

#[test]
fn facts_file_invariants() {
    let facts = facts();
    let mut ids = std::collections::HashSet::new();
    for f in &facts {
        assert!(ids.insert(f.id.clone()), "duplicate id {}", f.id);
        for lang in [Lang::Id, Lang::En] {
            assert!(!f.keywords.get(lang).is_empty(), "{}: no keywords", f.id);
            assert!(!f.text.get(lang).trim().is_empty(), "{}: empty text", f.id);
            assert!(
                !f.fallback_line.get(lang).trim().is_empty(),
                "{}: empty fallback",
                f.id
            );
        }
        if !f.public {
            continue; // private placeholders may still be TODO
        }
        for lang in [Lang::Id, Lang::En] {
            let text = f.text.get(lang);
            let words = text.split_whitespace().count();
            assert!(words <= 25, "{} ({lang:?}): {words} words, max 25", f.id);
            assert!(!text.contains("TODO"), "{}: public fact still TODO", f.id);
            // Anchors must be in the fact itself, and the fallback must pass the validator,
            // otherwise the safety net would reject its own line.
            for m in &f.must_contain {
                assert!(
                    text.to_lowercase().contains(&m.to_lowercase()),
                    "{} ({lang:?}): anchor {m:?} not in text",
                    f.id
                );
            }
            assert!(
                validate_answer(f, f.fallback_line.get(lang)),
                "{} ({lang:?}): fallback_line fails its own validation",
                f.id
            );
        }
    }
}

#[test]
fn language_detection_matches_eval_set() {
    let bad: Vec<_> = questions()
        .into_iter()
        .filter(|q| detect_lang(&q.q) != q.lang)
        .map(|q| q.q)
        .collect();
    assert!(bad.is_empty(), "language misdetected: {bad:#?}");
}

#[test]
fn retrieval_matches_eval_set() {
    let facts = facts();
    let misses: Vec<String> = questions()
        .iter()
        .filter_map(|q| {
            let got = lookup(&facts, q, MIN_SCORE);
            (got != q.expect).then(|| format!("{:?}: expected {:?}, got {:?}", q.q, q.expect, got))
        })
        .collect();
    assert!(
        misses.is_empty(),
        "retrieval misses:\n{}",
        misses.join("\n")
    );
}

/// Prints correct / wrong-fact / false-reject per threshold. A wrong fact is worse than a
/// polite deflection, so pick the middle of the plateau with the fewest wrong facts.
#[test]
#[ignore]
fn sweep() {
    let facts = facts();
    let qs = questions();
    println!("min_score  correct  wrong  false-reject  (of {})", qs.len());
    for step in 0..=24 {
        let th = 0.5 + step as f32 * 0.1;
        let (mut ok, mut wrong, mut reject) = (0, 0, 0);
        for q in &qs {
            let got = lookup(&facts, q, th);
            if got == q.expect {
                ok += 1;
            } else if got.is_none() {
                reject += 1;
            } else {
                wrong += 1;
            }
        }
        println!("{th:7.2}    {ok:5}   {wrong:5}   {reject:5}");
    }
}
