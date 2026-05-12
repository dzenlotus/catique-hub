/**
 * catique-sidecar — MCP server (ctq-112 / E5 round 1).
 *
 * Architecture (architect's plan, R-1 + R-2):
 *
 *   Rust  ──stdin──▶  Node sidecar  ──stdout──▶  Rust
 *
 * stdin and stdout carry TWO multiplexed streams over a single pipe each:
 *
 *   * MCP traffic   — newline-delimited JSON-RPC consumed by
 *                     `StdioServerTransport` from `@modelcontextprotocol/sdk`.
 *
 *   * Supervisor    — newline-delimited JSON-RPC for Rust↔Node lifecycle
 *                     (`__ping`, `__shutdown`) plus the reverse `ipc_call`
 *                     channel that lets MCP tool handlers reach Rust use
 *                     cases without a Tauri round-trip.
 *
 * Frames in the second class are prefixed with a single `\x01` byte (SOH,
 * never legal inside JSON). Rust strips it before forwarding; Node strips
 * it on intake and re-adds it on emit. The MCP SDK only sees the plain
 * JSON-RPC channel via `PassThroughStdio`.
 *
 * NOT in scope this round (MCP-S* deferrals — see ctq-112 brief):
 *
 *   * Shared-secret env handshake (MCP-S4).
 *   * Canonical-XML get_task_bundle serialiser (MCP-S5).
 *   * sidecar_stop IPC command (MCP-S6).
 *   * Per-session role scope filtering (MCP-S7).
 */

import { Readable, Writable } from "node:stream";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const LOG_PREFIX = "[catique-sidecar]";
/** SOH — sentinel that distinguishes supervisor frames from MCP frames. */
const SUPERVISOR_SENTINEL = 0x01;

/** Write a diagnostic line to stderr. Never goes through the multiplexed channel. */
function log(msg) {
  process.stderr.write(`${LOG_PREFIX} ${msg}\n`);
}

// stdout EPIPE happens when Rust closes its end of the pipe before our
// last write completes (graceful shutdown race). Swallow it — readline
// 'close' on stdin still drives a clean exit.
process.stdout.on("error", (err) => {
  if (err && err.code === "EPIPE") return;
  log(`stdout error: ${err && err.stack ? err.stack : String(err)}`);
});

// ---------------------------------------------------------------------------
// Multiplexer
// ---------------------------------------------------------------------------

/**
 * Stream-layer demultiplexer for sentinel-prefixed supervisor frames.
 *
 * Reads bytes from `process.stdin`, accumulates them per line. A line is
 * "supervisor" iff its first byte is `\x01`. Supervisor frames are
 * delivered to `onSupervisorLine`; everything else is forwarded into a
 * `Readable` that the MCP `StdioServerTransport` consumes.
 *
 * Only a single newline scanner runs — important so we do not split
 * frames between the two consumers.
 */
function createInboundDemux(onSupervisorLine) {
  const mcpInbound = new Readable({
    read() {
      // Pure passthrough: production happens in `process.stdin.on('data')`.
    },
  });

  /** Bytes accumulated for the current (in-progress) line. */
  let buffer = Buffer.alloc(0);
  /** True once we have committed to a class for the current line. */
  let lineIsSupervisor = null;

  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      // Decide the class of the current line if not yet decided.
      if (lineIsSupervisor === null && buffer.length > 0) {
        lineIsSupervisor = buffer[0] === SUPERVISOR_SENTINEL;
      }
      const nlIdx = buffer.indexOf(0x0a);
      if (nlIdx < 0) {
        // Incomplete line — must wait for more bytes. But we still need
        // to push everything-so-far to the MCP side if this line is MCP,
        // because the MCP transport buffers internally and expects to
        // see the bytes *as soon as they arrive* (it does its own
        // newline detection). Supervisor frames are line-buffered
        // here, so we hold them until the newline arrives.
        if (lineIsSupervisor === false && buffer.length > 0) {
          mcpInbound.push(buffer);
          buffer = Buffer.alloc(0);
        }
        return;
      }
      // We have a complete line at [0..nlIdx].
      const line = buffer.subarray(0, nlIdx + 1); // include the newline
      const rest = buffer.subarray(nlIdx + 1);
      if (lineIsSupervisor) {
        // Strip leading sentinel + trailing newline, hand the JSON body
        // to the supervisor handler.
        const json = line.subarray(1, nlIdx).toString("utf8").trim();
        if (json.length > 0) {
          onSupervisorLine(json);
        }
      } else {
        mcpInbound.push(line);
      }
      buffer = rest;
      lineIsSupervisor = null;
    }
  });

  process.stdin.on("end", () => {
    log("stdin ended, closing MCP inbound");
    mcpInbound.push(null);
  });

  return mcpInbound;
}

/**
 * Outbound writer that multiplexes onto a single `process.stdout`.
 *
 * The MCP SDK gets a `Writable` that emits **plain** JSON-RPC lines.
 * Supervisor frames go through `writeSupervisor`, which prefixes them
 * with the sentinel byte.
 */
function createOutboundMux() {
  const mcpOut = new Writable({
    write(chunk, _encoding, callback) {
      process.stdout.write(chunk, callback);
    },
  });
  function writeSupervisor(jsonString) {
    process.stdout.write(
      Buffer.concat([
        Buffer.from([SUPERVISOR_SENTINEL]),
        Buffer.from(jsonString + "\n", "utf8"),
      ]),
    );
  }
  return { mcpOut, writeSupervisor };
}

// ---------------------------------------------------------------------------
// Tool manifest + dispatch (Node side just declares the surface; bodies
// live in Rust use cases, reached via `ipc_call`).
// ---------------------------------------------------------------------------

async function loadToolManifest() {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "tool-manifest.json");
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.tools)) {
    throw new Error("tool-manifest.json: missing `tools` array");
  }
  return parsed.tools;
}

// ---------------------------------------------------------------------------
// Reverse channel: `ipc_call` from Node → Rust → use-case → response.
// ---------------------------------------------------------------------------

/** Pending `ipc_call` requests keyed by JSON-RPC id. */
const pendingIpcCalls = new Map();
let nextIpcId = 1;

/**
 * Send `{ method: "ipc_call", params: { method, params } }` over the
 * supervisor channel and resolve when Rust replies on the same id.
 */
function ipcCall(writeSupervisor, method, params) {
  const id = nextIpcId++;
  return new Promise((resolve, reject) => {
    pendingIpcCalls.set(id, { resolve, reject });
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "ipc_call",
      params: { method, params: params ?? null },
    });
    try {
      writeSupervisor(frame);
    } catch (err) {
      pendingIpcCalls.delete(id);
      reject(err);
    }
  });
}

/**
 * Handle a single inbound supervisor frame.
 *
 *   * Rust→Node lifecycle (`__ping`, `__shutdown`) → respond on the
 *     supervisor channel.
 *   * `ipc_call` *responses* (frames with `result` / `error` and an `id`
 *     we are waiting for) → resolve the matching pending promise.
 */
function handleSupervisorFrame(json, writeSupervisor) {
  let req;
  try {
    req = JSON.parse(json);
  } catch (err) {
    log(`supervisor parse error: ${err && err.message ? err.message : err}`);
    return;
  }
  // Response branch: routes back to a pending ipc_call.
  if (req && Object.prototype.hasOwnProperty.call(req, "id") &&
      (Object.prototype.hasOwnProperty.call(req, "result") ||
       Object.prototype.hasOwnProperty.call(req, "error")) &&
      pendingIpcCalls.has(req.id)) {
    const { resolve, reject } = pendingIpcCalls.get(req.id);
    pendingIpcCalls.delete(req.id);
    if (req.error) {
      const err = new Error(req.error.message || "ipc_call failed");
      err.code = req.error.code;
      reject(err);
    } else {
      resolve(req.result);
    }
    return;
  }
  // Request branch: Rust→Node lifecycle. Replies share the supervisor channel.
  const { id, method } = req || {};
  if (method === "__ping") {
    writeSupervisor(JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: { pong: true, ts: Date.now() },
    }));
    return;
  }
  if (method === "__shutdown") {
    writeSupervisor(JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } }));
    log("__shutdown received, exiting 0");
    setTimeout(() => process.exit(0), 50);
    return;
  }
  log(`supervisor: unknown method=${String(method)} id=${String(id)}`);
  if (id !== undefined && id !== null) {
    writeSupervisor(JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${String(method)}` },
    }));
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function installSignalHandlers() {
  const handle = (signal) => {
    log(`received ${signal}, exiting 0`);
    setTimeout(() => process.exit(0), 50);
  };
  process.on("SIGTERM", () => handle("SIGTERM"));
  process.on("SIGINT", () => handle("SIGINT"));
}

async function main() {
  installSignalHandlers();

  const { mcpOut, writeSupervisor } = createOutboundMux();
  const mcpInbound = createInboundDemux((json) =>
    handleSupervisorFrame(json, writeSupervisor),
  );

  const tools = await loadToolManifest();
  log(`loaded ${tools.length} tool(s) from tool-manifest.json`);

  const server = new Server(
    { name: "catique-sidecar", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params || {};
    const known = tools.find((t) => t.name === name);
    if (!known) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${String(name)}` }],
      };
    }
    try {
      const result = await ipcCall(writeSupervisor, name, args ?? {});
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      log(`ipc_call error name=${name}: ${msg}`);
      return {
        isError: true,
        content: [{ type: "text", text: msg }],
      };
    }
  });

  const transport = new StdioServerTransport(mcpInbound, mcpOut);
  await server.connect(transport);

  log(`started, pid=${process.pid}`);
}

main().catch((err) => {
  log(`fatal: ${err && err.stack ? err.stack : String(err)}`);
  process.exit(1);
});
