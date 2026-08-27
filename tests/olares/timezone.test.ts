import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { identityPrompt } from "@olares/lares-core/brand/identity";

const root = process.cwd();

test("Olares user timezone is required and mapped into every long-running container", () => {
  const manifest = parse(readFileSync(join(root, "deploy/lares/OlaresManifest.yaml"), "utf8"));
  const timezone = manifest.envs.find((entry: { envName?: string }) => entry.envName === "TIMEZONE");

  assert.deepEqual(timezone, {
    envName: "TIMEZONE",
    required: true,
    applyOnChange: true,
    valueFrom: { envName: "OLARES_USER_TIMEZONE" },
    description: "Time zone used by Lares, its agents, and commands (IANA name such as Asia/Shanghai)",
  });

  const deployment = readFileSync(join(root, "deploy/lares/templates/deployment.yaml"), "utf8");
  assert.equal(
    deployment.match(/- name: TZ\s+value: \{\{ \.Values\.olaresEnv\.TIMEZONE \| quote \}\}/g)?.length,
    2,
  );
});

test("the base image ships zoneinfo and the agent resolves current time through TZ", () => {
  const dockerfile = readFileSync(join(root, "Dockerfile.base"), "utf8");
  assert.match(dockerfile, /\bshellcheck tzdata yq\b/);
  assert.match(identityPrompt(), /run `date`; the process TZ is the user's configured Olares time zone/);
});

test("the app image follows the bumped timezone-capable base tag", () => {
  const project = JSON.parse(readFileSync(join(root, "project.json"), "utf8"));
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

  assert.equal(project.image_base_tag, "7");
  assert.match(dockerfile, /^ARG BASE_IMAGE=docker\.io\/beclab\/lares-base:7$/m);
});
