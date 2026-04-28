/**
 * catique-sidecar — minimal stdio JSON-RPC server.
 *
 * PoC for ctq-56 / ADR-0002 spike. Validates that Tauri can spawn this
 * process as a sidecar, communicate via line-delimited JSON-RPC 2.0 on
 * stdin/stdout, and observe graceful shutdown.
 *
 * NOT the real MCP server — no @modelcontextprotocol/sdk, no tool surface.
 * That is E5 work.
 *
 * Run standalone for debugging:
 *   node sidecar/index.js
 * Then type a JSON line, e.g.:
 *   {"jsonrpc":"2.0","id":1,"method":"ping","params":{}}
 */

import { createInterface } from "readline";

const LOG_PREFIX = "[catique-sidecar]";

/** Write to stderr with prefix for observability. */
function log(msg) {
  process.stderr.write(`${LOG_PREFIX} ${msg}\n`);
}

// Suppress EPIPE errors — these happen when the parent process closes its
// end of the pipe before we finish writing (e.g. during the smoke test
// stop sequence).  Graceful exit follows naturally via the readline close event.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") return;
  throw err;
});

/** Serialize and write a JSON-RPC response to stdout. */
function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

/** Build a JSON-RPC 2.0 error response. */
function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Dispatch a single JSON-RPC request object, return response object. */
function dispatch(req) {
  const { id, method } = req;

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: { pong: true, ts: Date.now() } };
  }

  if (method === "shutdown") {
    return { ok: true };
  }

  // JSON-RPC "Method not found"
  return errorResponse(id, -32601, `Method not found: ${String(method)}`);
}

// ---------------------------------------------------------------------------
// Signal handling — graceful exit within ~500 ms.
// ---------------------------------------------------------------------------

function shutdown(signal) {
  log(`received ${signal}, shutting down gracefully`);
  // Give any in-flight writes a tick to flush, then exit.
  setTimeout(() => process.exit(0), 50);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ---------------------------------------------------------------------------
// Main read loop — one JSON object per line from stdin.
// ---------------------------------------------------------------------------

log("started, pid=" + process.pid);

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    respond(errorResponse(null, -32700, "Parse error"));
    return;
  }

  log(`recv method=${String(req.method ?? "<none>")} id=${String(req.id ?? "null")}`);

  const response = dispatch(req);
  respond(response);

  // After responding, honour a shutdown request.
  if (req.method === "shutdown") {
    log("shutdown method received, exiting 0");
    // Flush stdout before exit.
    setTimeout(() => process.exit(0), 50);
  }
});

rl.on("close", () => {
  log("stdin closed, exiting 0");
  process.exit(0);
});
