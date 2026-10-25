#!/usr/bin/env node
/**
 * Compares two or more result files written by run.mjs --json, scenario by scenario.
 *
 *   node scripts/voice-eval/compare.mjs base.json next.json [--failures] [--gate]
 *
 * A row is marked when the pass counts differ; --failures also prints what the failing runs did.
 * --gate treats the first file as the baseline and the last as the candidate, and exits 1 when the
 * candidate regressed: a scenario lost two or more runs, a scenario is missing, or the total fell by
 * more than the 5-run noise seen between identical passes (three runs per hundred).
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const files = args.filter((value) => !value.startsWith("--"));
const failures = args.includes("--failures");
const gate = args.includes("--gate");
const regressions = [];
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
      if (!now) regressions.push(`${model} ${id}: missing from the candidate`);
      else if (row.passed - now.passed >= 2) regressions.push(`${model} ${id}: ${row.passed}/${row.runs} -> ${now.passed}/${now.runs}`);
    }
    const [was, is] = [total(baseline), total(candidate)];
    if (was[0] - is[0] > Math.ceil(was[1] * 0.03)) regressions.push(`${model} total: ${was.join("/")} -> ${is.join("/")}`);
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
  process.exitCode = regressions.length ? 1 : 0;
}
