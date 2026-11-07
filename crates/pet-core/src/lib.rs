//! Pure, Pi-independent logic: facts, language detection, retrieval, prompt building and
//! answer validation. (A mock generator is still to come.) Everything here must be testable on a laptop.

pub mod facts;
pub mod lang;
pub mod prompt;
pub mod retrieval;
pub mod validate;

pub use facts::{load_facts, parse_facts, Fact, L10n, Lang};
pub use lang::detect_lang;
pub use prompt::build_prompt;
pub use retrieval::{retrieve, MIN_SCORE};
pub use validate::{ground, no_match_line, validate_answer, Grounded};
