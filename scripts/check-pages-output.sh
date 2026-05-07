#!/usr/bin/env bash
set -euo pipefail

test -s docs/index.html
grep -q '<div id="root"></div>' docs/index.html
test -s docs/404.html
test -f docs/.nojekyll
