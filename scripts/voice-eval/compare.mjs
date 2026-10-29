#!/usr/bin/env node
/**
 * Compares two or more result files written by run.mjs --json, scenario by scenario.
 *
 *   node scripts/voice-eval/compare.mjs base.json next.json [--failures] [--gate [--only-shared]]
 *
 * A row is marked when the pass counts differ; --failures also prints what the failing runs did.
 * --gate treats the first file as the baseline and the last as the candidate, and exits 1 when the
 * candidate regressed: a scenario's pass rate fell by 40 points (two of five runs; 30 points once
 * the candidate ran it ten times or more), a scenario is missing, or the scenarios both ran lost
 * more than three runs per hundred. Identical dialogues differ by up to three of five runs on one
 * scenario, so regress.sh runs every flagged scenario again, ten times, before calling it a
 * regression. The ids it flagged are printed on a "flagged:" line.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const files = args.filter((value) => !value.startsWith("--"));
const failures = args.includes("--failures");
const gate = args.includes("--gate");
// A re-run of a few flagged scenarios is compared on those alone.
const onlyShared = args.includes("--only-shared");
const regressions = [];
const flagged = new Set();
const reports = files.map((file) => JSON.parse(readFileSync(file, "utf8")));
const labels = files.map((file) => file.split("/").pop().replace(/\.json$/, ""));

for (const model of Object.keys(reports[0].models)) {
  const tables = reports.map((report) => { const { served, ...rows } = report.models[model] || {}; return rows; });
  const served = reports.map((report) => report.models[model]?.served?.join(", ") || "?");
  const ids = [...new Set(tables.flatMap((table) => Object.keys(table)))];
  console.log(`\n=== ${model} · served by ${[...new Set(served)].join(" | ")}`);
  console.log(`${"scenario".padEnd(26)}${labels.map((label) => label.slice(0, 12).padEnd(13)).join("")}`);
  for (const id of ids) {
    const cells = tables.map((table) => (table[id] ? `${table[id].passed}/${table[id].runs}` : "-"));
    console.log(`${id.padEnd(26)}${cells.map((cell) => cell.padEnd(13)).join("")}${new Set(cells).size > 1 ? "<" : ""}`);
  }
  const total = (table) => Object.values(table).reduce((sum, row) => [sum[0] + row.passed, sum[1] + row.runs], [0, 0]);
  const clean = (table) => Object.values(table).filter((row) => row.passed === row.runs).length;
  console.log(`${"runs passed".padEnd(26)}${tables.map((table) => total(table).join("/").padEnd(13)).join("")}`);
  console.log(`${"scenarios clean".padEnd(26)}${tables.map((table) => `${clean(table)}/${Object.keys(table).length}`.padEnd(13)).join("")}`);
  if (gate) {
    const [baseline, candidate] = [tables[0], tables.at(-1)];
    for (const [id, row] of Object.entries(baseline)) {
      const now = candidate[id];
      if (!now) { if (!onlyShared) regressions.push(`${model} ${id}: missing from the candidate`); continue; }
      const drop = row.passed / row.runs - now.passed / now.runs;
      if (drop >= (now.runs >= 10 ? 0.3 : 0.4) - 1e-9) { regressions.push(`${model} ${id}: ${row.passed}/${row.runs} -> ${now.passed}/${now.runs}`); flagged.add(id); }
    }
    // Only scenarios both ran: a scenario added since the baseline is not a loss.
    const shared = Object.keys(baseline).filter((id) => candidate[id]);
    const pick = (table) => Object.fromEntries(shared.map((id) => [id, table[id]]));
    const [was, is] = [total(pick(baseline)), total(pick(candidate))];
    if (was[1] && was[0] / was[1] - is[0] / is[1] > 0.03) regressions.push(`${model} shared total: ${was.join("/")} -> ${is.join("/")}`);
  }
  if (!failures) continue;
  for (const [index, table] of tables.entries()) {
    for (const [id, row] of Object.entries(table)) {
      for (const result of row.results.filter((item) => item.problems.length)) console.log(`  ${labels[index]} ${id}: ✗ ${result.problems.join("; ")} · ${result.did.slice(0, 200)}`);
    }
  }
}

if (gate) {
  console.log(regressions.length ? `\nREGRESSED\n  ${regressions.join("\n  ")}` : "\nno regression against the baseline");
  if (flagged.size) console.log(`flagged: ${[...flagged].join(",")}`);
  process.exitCode = regressions.length ? 1 : 0;
}
