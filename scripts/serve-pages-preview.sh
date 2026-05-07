#!/usr/bin/env bash
set -euo pipefail

rm -rf tmp/pages-preview
mkdir -p tmp/pages-preview
cp -R docs tmp/pages-preview/cipher
npx http-server tmp/pages-preview -a 127.0.0.1 -p "${PORT:-4174}" -c-1
