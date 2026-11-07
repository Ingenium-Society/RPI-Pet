use crate::facts::Lang;

/// Words that strongly suggest Indonesian. Words shared with English ("a", "me", ...) are left out.
const ID_MARKERS: &[&str] = &[
    "apa",
    "siapa",
    "yang",
    "kamu",
    "aku",
    "itu",
    "ini",
    "dan",
    "di",
    "dengan",
    "untuk",
    "kapan",
    "dimana",
    "bagaimana",
    "gimana",
    "berapa",
    "apakah",
    "bisa",
    "ada",
    "dari",
    "tentang",
    "nggak",
    "gak",
    "kenapa",
    "mengapa",
    "dong",
    "sih",
    "ngapain",
    "dibuat",
    "saja",
    "aja",
    "pakai",
    "ya",
    "cara",
    "gabung",
    "ceritain",
    "ceritakan",
    "dia",
    "kita",
    "nama",
];

/// Words that strongly suggest English.
const EN_MARKERS: &[&str] = &[
    "what", "who", "the", "you", "are", "is", "how", "when", "where", "why", "do", "does", "can",
    "your", "about", "of", "to", "tell", "me", "this", "there", "was", "it", "happens", "at",
    "have", "a", "an", "i", "my", "which", "with",
];

/// Guess the language of a visitor's question by counting marker words.
/// Ties (including questions with no markers, like a bare name) default to Indonesian,
/// the main audience of the school.
pub fn detect_lang(text: &str) -> Lang {
    let lower = text.to_lowercase();
    let (mut id, mut en) = (0usize, 0usize);
    for w in lower.split(|c: char| !c.is_alphanumeric()) {
        if ID_MARKERS.contains(&w) {
            id += 1;
        }
        if EN_MARKERS.contains(&w) {
            en += 1;
        }
    }
    if en > id {
        Lang::En
    } else {
        Lang::Id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_indonesian() {
        assert_eq!(detect_lang("Siapa ketua klubnya?"), Lang::Id);
        assert_eq!(detect_lang("Kamu ini AI ya?"), Lang::Id);
        assert_eq!(detect_lang("Gimana cara gabung klub?"), Lang::Id);
    }

    #[test]
    fn detects_english() {
        assert_eq!(detect_lang("Who is the leader of the club?"), Lang::En);
        assert_eq!(detect_lang("Are you a language model?"), Lang::En);
        assert_eq!(detect_lang("Tell me a joke"), Lang::En);
    }

    #[test]
    fn ambiguous_input_defaults_to_indonesian() {
        assert_eq!(detect_lang("Haidar?"), Lang::Id);
        assert_eq!(detect_lang(""), Lang::Id);
    }
}
