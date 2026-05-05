//! `Space` — top-level container of boards. Mirrors `spaces` table.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A workspace partition. Holds a fleet of boards under a short prefix
/// (`prefix` — `[a-z0-9-]{1,10}`) used for slug generation
/// (`<prefix>-NN`). Exactly one space is marked `is_default`.
///
/// `color` (`#RRGGBB`) and `icon` (pixel-icon identifier) are optional
/// presentation hints — see migration `008_space_board_icons_colors.sql`.
/// `None` means "use the default rendering"; the TS layer maps the icon
/// string onto a React component from `src/shared/ui/Icon/`.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub id: String,
    pub name: String,
    pub prefix: String,
    pub description: Option<String>,
    /// Optional `#RRGGBB` colour override. `None` falls back to the
    /// frontend's default palette entry for the space.
    pub color: Option<String>,
    /// Optional pixel-icon identifier. The TS layer maps this string
    /// onto a React component from `src/shared/ui/Icon/`. `None` (and
    /// any identifier the frontend doesn't recognise) renders no icon.
    pub icon: Option<String>,
    pub is_default: bool,
    pub position: f64,
    pub created_at: i64,
    pub updated_at: i64,
}
