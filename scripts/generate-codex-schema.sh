#!/bin/sh
set -eu

version="$(codex --version | awk '{print $2}')"
out="schemas/codex-${version}"
mkdir -p "$out"
codex app-server generate-ts --experimental --out "$out"
codex app-server generate-json-schema --experimental --out "$out/json"
echo "Generated Codex app-server bindings for ${version} in ${out}"
