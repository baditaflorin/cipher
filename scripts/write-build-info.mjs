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

const commit = gitValue("git rev-parse --short=12 HEAD", "development");
const branch = gitValue("git branch --show-current", "local");
const builtAt = gitValue("git show -s --format=%cI HEAD", new Date().toISOString());

const output = `export const buildInfo = ${JSON.stringify(
  {
    version: packageJson.version,
    commit,
    branch,
    builtAt,
    repositoryUrl: "https://github.com/baditaflorin/cipher",
    paypalUrl: "https://www.paypal.com/paypalme/florinbadita",
    pagesUrl: "https://baditaflorin.github.io/cipher/"
  },
  null,
  2
)} as const;\n`;

const target = resolve(root, "src/generated/buildInfo.ts");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, output);
