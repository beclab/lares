import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("../..", import.meta.url)));
const CORE = JSON.parse(readFileSync(join(ROOT, "packages/core/package.json"), "utf8"));
const SOURCE = new Set([".js", ".mjs", ".cjs", ".vue"]);
const FROM = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\sfrom\s+)?["']([^"']+)["']/g;
const DYNAMIC = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

const ENTRIES = [
  "packages/mobile/src/index.js",
  "packages/web/workspace-preview/src/client/index.js",
  "packages/web/workspace-preview-3d/src/client/index.js",
  "packages/core/drive/paths.js",
  "packages/core/files/markdown.js",
];

function scriptOf(file, text) {
  if (extname(file) !== ".vue") return text;
  const match = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(text);
  return match ? match[1] : "";
}

function specifiers(text) {
  return [...text.matchAll(FROM), ...text.matchAll(DYNAMIC)].map((match) => match[1]);
}

function coreFile(subpath) {
  const target = CORE.exports[`./${subpath}`];
  const file = typeof target === "string" ? target : target?.default;
  if (typeof file !== "string") return null;
  return join(ROOT, "packages/core", file);
}

function resolveSpec(fromFile, spec) {
  if (spec.startsWith("@olares/lares-core/")) return coreFile(spec.slice("@olares/lares-core/".length));
  if (!spec.startsWith(".")) return null;
  const candidate = join(dirname(fromFile), spec);
  return isAbsolute(candidate) ? candidate : null;
}

function leaksFrom(entry) {
  const start = join(ROOT, entry);
  const queue = [[start, []]];
  const seen = new Set();
  const leaks = [];
  while (queue.length > 0) {
    const [file, chain] = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!SOURCE.has(extname(file))) continue;
    const text = scriptOf(file, readFileSync(file, "utf8"));
    const here = relative(ROOT, file);
    for (const spec of specifiers(text)) {
      const next = [...chain, `${here} → ${spec}`];
      if (spec.startsWith("node:") || spec === "crypto" || spec === "fs" || spec === "path") {
        leaks.push(next.join("\n"));
        continue;
      }
      const resolved = resolveSpec(file, spec);
      if (resolved) queue.push([resolved, next]);
    }
  }
  return leaks;
}

test("browser-facing modules do not import Node builtins", () => {
  const leaks = ENTRIES.flatMap(leaksFrom);
  assert.deepEqual(leaks, []);
});
