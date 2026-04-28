//! Per-entity repositories. Pure synchronous methods over a
//! `&rusqlite::Connection` (or `&mut Connection` for transactional
//! ones). Async + pool acquisition is the use-case layer's job.

pub mod boards;
