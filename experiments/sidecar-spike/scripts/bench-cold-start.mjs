/**
 * Cold-start benchmark for the sidecar spike.
 *
 * Measures the wall-clock time from `child_process.spawn(node, [index.js])`
 * to receipt of the first echo response. This approximates the Tauri
 * `setup` -> first echo path; the only delta is Tauri's own boot time
 * (constant, not under sidecar's control).
 *
 * Runs N iterations, reports min / median / max in milliseconds.
 *
 * Usage:
 *   node scripts/bench-cold-start.mjs [iterations]
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIDECAR_PATH = resolve(__dirname, "..", "sidecar", "index.js");

const N = Number(process.argv[2] ?? 5);

async function oneRun(i) {
  const t0 = performance.now();

  const child = spawn(process.execPath, [SIDECAR_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Drain stderr so the pipe never fills.
  child.stderr.on("data", () => {});

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

  const respPromise = new Promise((resolveResp, rejectResp) => {
    rl.once("line", (line) => {
      try {
        resolveResp(JSON.parse(line));
      } catch (e) {
        rejectResp(e);
      }
    });
    child.once("error", rejectResp);
  });

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "echo", params: { msg: `cold-start-${i}` } })}\n`);

  const resp = await respPromise;
  const elapsed = performance.now() - t0;

  if (resp?.result?.echoed !== `cold-start-${i}`) {
    throw new Error(`unexpected response: ${JSON.stringify(resp)}`);
  }

  // Graceful shutdown so the next iteration's port-zero / fd-zero is clean.
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "shutdown" })}\n`);
  child.stdin.end();

  await new Promise((res) => child.once("exit", res));

  return elapsed;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

console.log(`sidecar-spike cold-start bench: ${N} iterations`);
console.log(`node ${process.version} on ${process.platform}/${process.arch}`);
console.log(`sidecar path: ${SIDECAR_PATH}\n`);

const results = [];
for (let i = 0; i < N; i++) {
  // small jitter so iterations are not back-to-back disk-cache-warm
  if (i > 0) await new Promise((r) => setTimeout(r, 50));
  const ms = await oneRun(i);
  results.push(ms);
  console.log(`  run ${i + 1}: ${ms.toFixed(1)} ms`);
}

console.log(`\nmin    : ${Math.min(...results).toFixed(1)} ms`);
console.log(`median : ${median(results).toFixed(1)} ms`);
console.log(`max    : ${Math.max(...results).toFixed(1)} ms`);
