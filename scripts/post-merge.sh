#!/bin/bash
set -e

# Recreate node_modules from the lockfile. A regular npm install can leave an
# obsolete nested Expo CLI behind, which Metro then sees outside its file map.
npm ci --legacy-peer-deps

# Clear Metro bundler cache to avoid stale file-map errors after package changes
rm -rf /tmp/metro-file-map-* /tmp/metro-* /tmp/haste-map-* 2>/dev/null || true
