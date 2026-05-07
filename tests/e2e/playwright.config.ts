import { defineConfig } from "playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4174/cipher/"
  },
  webServer: {
    command: "bash scripts/serve-pages-preview.sh",
    cwd: repoRoot,
    url: "http://127.0.0.1:4174/cipher/",
    reuseExistingServer: !process.env.CI
  }
});
