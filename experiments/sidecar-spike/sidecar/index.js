/**
 * sidecar-spike — minimal stdio JSON-RPC server.
 *
 * Validates ADR-0002 assumptions for ctq-56:
 *   1. Tauri 2.x can spawn this Node process at startup.
 *   2. Line-delimited JSON-RPC 2.0 over stdio works (echo, ping).
 *   3. Cold-start (spawn -> first echo response) is measurable.
 *
 * Methods:
 *   echo({msg})  -> {echoed: msg, ts: <unix-ms>}
 *   ping()       -> {pong: true, ts: <unix-ms>}
 *   shutdown()   -> {ok: true}, then process.exit(0) after 50 ms flush tick.
 *
 * Mirrors the canonical sidecar/index.js shape; intentionally NOT importing
 * @modelcontextprotocol/sdk — that is E5 work, out of scope for this spike.
 */

import { createInterface } from "node:readline";

const LOG_PREFIX = "[sidecar-spike]";

function log(msg) {
  process.stderr.write(`${LOG_PREFIX} ${msg}\n`);
}

// EPIPE happens when Rust closes its end before our last write completes.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") return;
  throw err;
});

function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function dispatch(req) {
  const { id, method, params } = req;

  if (method === "echo") {
    const msg = params && typeof params === "object" ? params.msg : undefined;
    return { jsonrpc: "2.0", id, result: { echoed: msg ?? null, ts: Date.now() } };
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: { pong: true, ts: Date.now() } };
  }

  if (method === "shutdown") {
    return { jsonrpc: "2.0", id, result: { ok: true } };
  }

  return errorResponse(id, -32601, `Method not found: ${String(method)}`);
}

function shutdown(signal) {
  log(`received ${signal}, shutting down gracefully`);
  setTimeout(() => process.exit(0), 50);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

log(`started, pid=${process.pid}, node=${process.version}`);

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

  if (req.method === "shutdown") {
    log("shutdown method received, exiting 0");
    setTimeout(() => process.exit(0), 50);
  }
});

rl.on("close", () => {
  log("stdin closed, exiting 0");
  process.exit(0);
});
