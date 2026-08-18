//! Provider core shared by the Axum HTTP server.
//!
//! This crate deliberately has no desktop runtime dependency: the React client
//! runs in a browser and all native/network operations are exposed by Axum.

pub mod ews;
pub mod gmail;
pub mod imap;
pub mod jmap;
pub mod mail;
pub mod mail_provider;
pub mod sync;

pub mod command;
#[cfg(target_os = "android")]
mod native_android;
