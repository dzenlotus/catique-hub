//! ctq-84 perf gate (P99 < 100 ms on 10k seeded tasks).
//!
//! Seeds an in-memory DB with 10 000 tasks distributed across 5 boards
//! within a single space, evenly split across 5 cats (roles), then runs
//! `search_tasks_by_cat_and_space` repeatedly so criterion can observe
//! a stable p99. The 100 ms target lives in the wave-brief; merge
//! requires the criterion summary line `p99` to come in under that
//! ceiling on a developer-class M-series machine.
//!
//! Run:
//!
//! ```bash
//! cargo bench -p catique-infrastructure --bench search_by_cat_and_space
//! ```

use std::time::Duration;

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use rusqlite::{params, Connection};

use catique_infrastructure::db::{
    repositories::tasks::search_tasks_by_cat_and_space, runner::run_pending,
};

/// Seed + return a fresh in-memory connection ready for search runs.
/// Returns the connection plus the canonical `(space_id, cat_id)` we
/// hand the bench loop.
fn seed() -> (Connection, &'static str, &'static str) {
    let mut conn = Connection::open_in_memory().expect("open");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("PRAGMA");
    run_pending(&mut conn).expect("migrations");

    // 1 space, 5 boards, 5 columns, 5 cats. The query JOINs `boards`
    // and filters `space_id`, so all 10k tasks must live under `sp`.
    conn.execute_batch(
        "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
             VALUES ('sp', 'Bench', 'bn', 0, 0, 0, 0); \
         INSERT INTO boards (id, name, space_id, position, created_at, updated_at, owner_role_id) VALUES \
             ('bd1', 'B1', 'sp', 0, 0, 0, 'maintainer-system'), \
             ('bd2', 'B2', 'sp', 1, 0, 0, 'maintainer-system'), \
             ('bd3', 'B3', 'sp', 2, 0, 0, 'maintainer-system'), \
             ('bd4', 'B4', 'sp', 3, 0, 0, 'maintainer-system'), \
             ('bd5', 'B5', 'sp', 4, 0, 0, 'maintainer-system'); \
         INSERT INTO columns (id, board_id, name, position, created_at) VALUES \
             ('co1', 'bd1', 'C', 0, 0), \
             ('co2', 'bd2', 'C', 0, 0), \
             ('co3', 'bd3', 'C', 0, 0), \
             ('co4', 'bd4', 'C', 0, 0), \
             ('co5', 'bd5', 'C', 0, 0); \
         INSERT INTO roles (id, name, content, created_at, updated_at) VALUES \
             ('cat1', 'Cat1', '', 0, 0), \
             ('cat2', 'Cat2', '', 0, 0), \
             ('cat3', 'Cat3', '', 0, 0), \
             ('cat4', 'Cat4', '', 0, 0), \
             ('cat5', 'Cat5', '', 0, 0);",
    )
    .expect("seed");

    // 10 000 tasks. Distributing across 5 boards × 5 cats hits every
    // (board, cat) pair so the rank predicate exercises a realistic
    // mix of matches and pruned rows. Title carries the search term
    // "alpha" on roughly 1 in 5 tasks so most queries return a few
    // hundred candidate rows before the LIMIT 20 truncates.
    let tx = conn.transaction().expect("tx");
    for i in 0_u32..10_000 {
        let board_idx = (i % 5) as usize;
        let cat_idx = ((i / 5) % 5) as usize;
        let bd = ["bd1", "bd2", "bd3", "bd4", "bd5"][board_idx];
        let co = ["co1", "co2", "co3", "co4", "co5"][board_idx];
        let cat = ["cat1", "cat2", "cat3", "cat4", "cat5"][cat_idx];
        let title = if i % 5 == 0 {
            format!("alpha bravo task {i}")
        } else {
            format!("delta echo task {i}")
        };
        let slug = format!("bn-{i}");
        tx.execute(
            "INSERT INTO tasks \
                 (id, board_id, column_id, slug, title, description, position, role_id, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0)",
            params![
                format!("t{i}"),
                bd,
                co,
                slug,
                title,
                "filler description body",
                f64::from(i),
                cat,
            ],
        )
        .expect("task");
    }
    tx.commit().expect("commit tasks");

    (conn, "sp", "cat1")
}

fn bench_search(c: &mut Criterion) {
    let (conn, space_id, cat_id) = seed();

    let mut group = c.benchmark_group("search_tasks_by_cat_and_space");
    group.sample_size(200);
    group.measurement_time(Duration::from_secs(10));
    group.bench_function("p99_under_100ms_on_10k_tasks", |b| {
        b.iter(|| {
            let hits =
                search_tasks_by_cat_and_space(&conn, space_id, cat_id, "alpha").expect("search");
            black_box(hits.len());
        });
    });
    group.finish();
}

criterion_group!(benches, bench_search);
criterion_main!(benches);
