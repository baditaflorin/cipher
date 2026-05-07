import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

function gitValue(command, fallback) {
  try {
    return execSync(command, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

const sourceCommitCommand =
  'git log -1 --format=%H -- . ":(exclude)docs/**" ":(exclude)src/generated/buildInfo.ts"';
const sourceCommitDateCommand =
  'git log -1 --format=%cI -- . ":(exclude)docs/**" ":(exclude)src/generated/buildInfo.ts"';
const commit = gitValue(sourceCommitCommand, "development").slice(0, 12);
const branch = gitValue("git branch --show-current", "local");
const builtAt = gitValue(sourceCommitDateCommand, new Date().toISOString());

const output = `export const buildInfo = {
  version: ${JSON.stringify(packageJson.version)},
  commit: ${JSON.stringify(commit)},
  branch: ${JSON.stringify(branch)},
  builtAt: ${JSON.stringify(builtAt)},
  repositoryUrl: "https://github.com/baditaflorin/cipher",
  paypalUrl: "https://www.paypal.com/paypalme/florinbadita",
  pagesUrl: "https://baditaflorin.github.io/cipher/"
} as const;\n`;

const target = resolve(root, "src/generated/buildInfo.ts");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, output);
