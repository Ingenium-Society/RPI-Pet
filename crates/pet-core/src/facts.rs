use serde::{Deserialize, Serialize};
use std::{error::Error, fs, path::Path};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    Id,
    En,
}

/// A value that exists in both Indonesian and English.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct L10n<T> {
    pub id: T,
    pub en: T,
}

impl<T> L10n<T> {
    pub fn get(&self, lang: Lang) -> &T {
        match lang {
            Lang::Id => &self.id,
            Lang::En => &self.en,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fact {
    pub id: String,
    /// "me" | "partner" | "club" | "pet"
    pub about: String,
    /// Only public facts can ever be retrieved.
    #[serde(default)]
    pub public: bool,
    pub keywords: L10n<Vec<String>>,
    /// One sentence, 25 words or fewer.
    pub text: L10n<String>,
    /// Pre-written pet-voice version, used when the model fails validation.
    pub fallback_line: L10n<String>,
    /// Names/numbers that must appear in a model answer for it to count as grounded.
    #[serde(default)]
    pub must_contain: Vec<String>,
}

pub fn parse_facts(json: &str) -> Result<Vec<Fact>, serde_json::Error> {
    serde_json::from_str(json)
}

pub fn load_facts(path: impl AsRef<Path>) -> Result<Vec<Fact>, Box<dyn Error + Send + Sync>> {
    let raw = fs::read_to_string(path)?;
    Ok(parse_facts(&raw)?)
}
