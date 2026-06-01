#!/bin/bash
set -e

npm install --legacy-peer-deps

# Clear Metro bundler cache to avoid stale file-map errors after package changes
rm -rf /tmp/metro-file-map-* /tmp/metro-* /tmp/haste-map-* 2>/dev/null || true
