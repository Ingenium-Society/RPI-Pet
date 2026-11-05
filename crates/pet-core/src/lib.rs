//! Pure, Pi-independent logic: facts, retrieval, and (later) prompt building,
//! validation and a mock generator. Everything here must be testable on a laptop.

pub mod facts;
pub mod retrieval;

pub use facts::{load_facts, parse_facts, Fact, Lang, L10n};
