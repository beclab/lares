#!/usr/bin/env node
/**
 * Compares two or more result files written by run.mjs --json, scenario by scenario.
 *
 *   node scripts/voice-eval/compare.mjs base.json next.json [--failures]
 *
 * A row is marked when the pass counts differ; --failures also prints what the failing runs did.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const files = args.filter((value) => !value.startsWith("--"));
const failures = args.includes("--failures");
const reports = files.map((file) => JSON.parse(readFileSync(file, "utf8")));
const labels = files.map((file) => file.split("/").pop().replace(/\.json$/, ""));

for (const model of Object.keys(reports[0].models)) {
  const tables = reports.map((report) => report.models[model] || {});
  const ids = [...new Set(tables.flatMap((table) => Object.keys(table)))];
  console.log(`\n=== ${model}`);
  console.log(`${"scenario".padEnd(26)}${labels.map((label) => label.slice(0, 12).padEnd(13)).join("")}`);
  for (const id of ids) {
    const cells = tables.map((table) => (table[id] ? `${table[id].passed}/${table[id].runs}` : "-"));
    console.log(`${id.padEnd(26)}${cells.map((cell) => cell.padEnd(13)).join("")}${new Set(cells).size > 1 ? "<" : ""}`);
  }
  const total = (table) => Object.values(table).reduce((sum, row) => [sum[0] + row.passed, sum[1] + row.runs], [0, 0]);
  const clean = (table) => Object.values(table).filter((row) => row.passed === row.runs).length;
  console.log(`${"runs passed".padEnd(26)}${tables.map((table) => total(table).join("/").padEnd(13)).join("")}`);
  console.log(`${"scenarios clean".padEnd(26)}${tables.map((table) => `${clean(table)}/${Object.keys(table).length}`.padEnd(13)).join("")}`);
  if (!failures) continue;
  for (const [index, table] of tables.entries()) {
    for (const [id, row] of Object.entries(table)) {
      for (const result of row.results.filter((item) => item.problems.length)) console.log(`  ${labels[index]} ${id}: ✗ ${result.problems.join("; ")} · ${result.did.slice(0, 200)}`);
    }
  }
}
