/**
 * Tiny LCS-based line diff.
 *
 * Returns a flat list of {kind, text} entries representing the
 * "left → right" patch (i.e. how to turn `a` into `b`):
 *   - `context` lines exist in both inputs.
 *   - `removed` lines exist only in `a` (the older / selected version).
 *   - `added`   lines exist only in `b` (the current content).
 *
 * The implementation is the standard 2-D LCS table → backtrace.  Memory
 * is `O((|a|+1) * (|b|+1))` ints which is fine for prompt / role
 * content (a few hundred lines max).
 *
 * The `diff` npm package is NOT a dependency of this repo (verified in
 * package.json on 2026-05-28), so we ship this 60-LoC helper instead of
 * pulling a dep just for the diff view.
 */

export type LineDiffKind = "context" | "added" | "removed";

export interface LineDiffEntry {
  kind: LineDiffKind;
  text: string;
}

export function lineDiff(a: string, b: string): LineDiffEntry[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const m = aLines.length;
  const n = bLines.length;

  // dp[i][j] = LCS length of aLines[i..m) vs bLines[j..n).
  // Backwards table → forward backtrace yields a stable output order.
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (aLines[i] === bLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const out: LineDiffEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      out.push({ kind: "context", text: aLines[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "removed", text: aLines[i] });
      i += 1;
    } else {
      out.push({ kind: "added", text: bLines[j] });
      j += 1;
    }
  }
  while (i < m) {
    out.push({ kind: "removed", text: aLines[i] });
    i += 1;
  }
  while (j < n) {
    out.push({ kind: "added", text: bLines[j] });
    j += 1;
  }
  return out;
}
