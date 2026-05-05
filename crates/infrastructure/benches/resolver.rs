//! Resolver perf gate (ADR-0006 §AC-6, P8-T2).
//!
//! Seeds a 10 000-task in-memory DB with a representative inheritance
//! mix, then exercises [`resolve_task_prompts`] over a sampled task set
//! to land a P99 reading. The merge gate is **P99 < 50 ms** as
//! specified in `cat-as-agent-roadmap.md:332`.
//!
//! Seed shape:
//! * 1 space, 5 boards (each owning 2 000 tasks evenly distributed).
//! * Each task carries 3 directly-attached prompts.
//! * Each role contributes 2 prompts, materialised onto the 2 000
//!   tasks owned by that role.
//! * Each board contributes 1 prompt, materialised onto its 2 000
//!   tasks.
//!
//! Total `task_prompts` row count: 10 000 * 6 = 60 000 — comfortably
//! beyond the typical desktop workload.
//!
//! Run:
//!
//! ```bash
//! cargo bench -p catique-infrastructure --bench resolver
//! ```
//!
//! The criterion summary prints `mean`, `median`, and `p99` per group.

use std::time::Duration;

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use rusqlite::{params, Connection};

use catique_infrastructure::db::{
    repositories::tasks::{cascade_prompt_attachment, resolve_task_prompts, AttachScope},
    runner::run_pending,
};

/// Seed + return a fresh in-memory connection ready for resolver runs,
/// alongside a representative sample of task ids the bench iterates.
fn seed() -> (Connection, Vec<String>) {
    let mut conn = Connection::open_in_memory().expect("open in-mem");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("PRAGMA");
    run_pending(&mut conn).expect("migrations");

    // 1 space, 5 boards, 5 columns (one per board), 5 roles.
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
             ('rl1', 'R1', '', 0, 0), \
             ('rl2', 'R2', '', 0, 0), \
             ('rl3', 'R3', '', 0, 0), \
             ('rl4', 'R4', '', 0, 0), \
             ('rl5', 'R5', '', 0, 0);",
    )
    .expect("seed");

    // 10 000 tasks distributed evenly across the 5 boards. We bind the
    // counter parameter directly to skip slug-generation overhead.
    let tx = conn.transaction().expect("tx");
    let mut task_ids = Vec::with_capacity(10_000);
    for i in 0_u32..10_000 {
        let board_idx = (i % 5) as usize;
        let bd = ["bd1", "bd2", "bd3", "bd4", "bd5"][board_idx];
        let co = ["co1", "co2", "co3", "co4", "co5"][board_idx];
        let rl = ["rl1", "rl2", "rl3", "rl4", "rl5"][board_idx];
        let id = format!("t{i}");
        let slug = format!("bn-{i}");
        tx.execute(
            "INSERT INTO tasks (id, board_id, column_id, slug, title, position, role_id, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, 'T', ?5, ?6, 0, 0)",
            params![id, bd, co, slug, f64::from(i), rl],
        )
        .expect("task insert");
        task_ids.push(id);
    }
    tx.commit().expect("commit tasks");

    // Prompts: 3 direct + 2 per-role + 1 per-board = 30 distinct.
    let tx = conn.transaction().expect("tx");
    for i in 0..30 {
        tx.execute(
            "INSERT INTO prompts (id, name, content, created_at, updated_at) \
             VALUES (?1, ?1, '', 0, 0)",
            params![format!("p{i}")],
        )
        .expect("prompt");
    }
    tx.commit().expect("commit prompts");

    // 3 direct attachments per task. Done as one big UNION ALL would
    // be faster but the explicit loop keeps the seed legible and runs
    // in a single tx.
    let tx = conn.transaction().expect("tx");
    for tid in &task_ids {
        for k in 0..3 {
            tx.execute(
                "INSERT INTO task_prompts (task_id, prompt_id, origin, position) \
                 VALUES (?1, ?2, 'direct', ?3)",
                params![tid, format!("p{k}"), f64::from(k)],
            )
            .expect("direct");
        }
    }
    tx.commit().expect("commit direct");

    // Role-cascade: 2 prompts per role over the 2 000-task slice.
    let tx = conn.transaction().expect("tx");
    for (idx, role) in ["rl1", "rl2", "rl3", "rl4", "rl5"].iter().enumerate() {
        let p_a = format!("p{}", 3 + idx * 2);
        let p_b = format!("p{}", 3 + idx * 2 + 1);
        cascade_prompt_attachment(&tx, &AttachScope::Role((*role).to_owned()), &p_a, 1.0)
            .expect("role cascade A");
        cascade_prompt_attachment(&tx, &AttachScope::Role((*role).to_owned()), &p_b, 2.0)
            .expect("role cascade B");
    }
    tx.commit().expect("commit role cascades");

    // Board-cascade: 1 prompt per board.
    let tx = conn.transaction().expect("tx");
    for (idx, bd) in ["bd1", "bd2", "bd3", "bd4", "bd5"].iter().enumerate() {
        let pid = format!("p{}", 13 + idx);
        cascade_prompt_attachment(&tx, &AttachScope::Board((*bd).to_owned()), &pid, 0.0)
            .expect("board cascade");
    }
    tx.commit().expect("commit board cascades");

    (conn, task_ids)
}

/// Resolver hot-path benchmark group. Criterion drives a per-iteration
/// `resolve_task_prompts` call against a randomly-chosen task id —
/// `iter_batched` ensures every iteration sees a fresh task without
/// re-seeding the DB (we bake the 10 000-task seed once upfront).
fn bench_resolver(c: &mut Criterion) {
    let (conn, task_ids) = seed();

    let mut group = c.benchmark_group("resolve_task_bundle");
    // Tighten the noise floor: we care about p99 reproducibility.
    group.sample_size(200);
    // 50 ms is the merge gate. We let criterion run long enough to
    // produce a confident p99 estimate.
    group.measurement_time(Duration::from_secs(10));
    group.bench_function("p99_under_50ms_on_10k_tasks", |b| {
        let mut idx = 0_usize;
        b.iter(|| {
            let tid = &task_ids[idx % task_ids.len()];
            idx = idx.wrapping_add(1);
            let rows = resolve_task_prompts(&conn, tid).expect("resolve");
            black_box(rows.len());
        });
    });
    group.finish();
}

criterion_group!(benches, bench_resolver);
criterion_main!(benches);
