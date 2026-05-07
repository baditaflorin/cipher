#!/usr/bin/env bash
set -euo pipefail

npm run build
npx playwright test --config=tests/e2e/playwright.config.ts
