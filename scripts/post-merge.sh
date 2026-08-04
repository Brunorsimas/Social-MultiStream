#!/usr/bin/env bash
set -Eeuo pipefail

# Recreate node_modules from the portable lockfile. This removes stale nested
# Expo CLI installations that Metro could otherwise discover outside its map.
npm ci --legacy-peer-deps

# Confirm that Node resolves the pinned, project-level Expo CLI after install.
node -e 'const path = require("node:path"); const expected = path.join(process.cwd(), "node_modules", "@expo", "cli") + path.sep; const resolved = require.resolve("@expo/cli"); if (!resolved.startsWith(expected)) { throw new Error(`Unexpected Expo CLI: ${resolved}`); }'

# Clear stale Metro maps only after the dependency tree has been recreated.
rm -rf /tmp/metro-file-map-* /tmp/metro-* /tmp/haste-map-* 2>/dev/null || true
