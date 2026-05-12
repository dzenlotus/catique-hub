/**
 * MCP-S8 smoke test placeholder — deferred.
 *
 * The architect's plan defers running the full sidecar smoke test on CI
 * to a follow-on ticket because Node availability across the runner
 * matrix is not yet guaranteed (see ctq-112 brief, "Out of scope this
 * round"). The skipped test below documents the intended contract so
 * the next maintainer can drop the `.skip` once the runner story is in
 * place.
 *
 * Intended flow once enabled:
 *
 *   1. Spawn `node ../index.js` as a child process.
 *   2. Speak the MCP `initialize` handshake on stdin/stdout.
 *   3. Issue `tools/list` and assert the five round-1 tools come back.
 *   4. Issue `tools/call list_boards`, mock the `ipc_call` reply on
 *      our side (Node should send the supervisor frame back to us),
 *      assert the response surfaces as `content[0].text`.
 *   5. Send `__shutdown` over the supervisor channel; assert the
 *      child exits within 500 ms.
 *
 * Until this lands, the Rust-side `smoke_ping_pong_shutdown` test in
 * `crates/sidecar/src/lib.rs` (also `#[ignore]`d) covers the
 * supervisor-channel half of the contract when run locally with
 * `cargo test -p catique-sidecar -- --ignored`.
 *
 * TODO(ctq-112-S8): wire this test once a node-bearing CI runner is
 * available and remove the `.skip`.
 */

import { describe, it } from "node:test";

describe("catique-sidecar (MCP)", () => {
  it.skip(
    "spawns, lists 5 tools, dispatches list_boards, and shuts down",
    async () => {
      // Intentionally empty — see file-level comment.
    },
  );
});
