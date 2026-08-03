---
name: Metro FallbackWatcher crash on .local directory
description: Why Metro crashes with ENOENT on Replit and how the fix works.
---

## The rule
`metro.config.js` must exclude `.local` from Metro's file map using a correctly escaped regex. The original code used `path.join(__dirname, "\\.local")` which produces `/workspace/\.local` (literal backslash on Linux) — a path that never exists, so the blockList regex never matched the real `/workspace/.local` directory.

**Why:** Replit creates and deletes volatile files in `.local/state/workflow-logs/` at runtime. Metro's FallbackWatcher calls `fs.watch()` on every directory it finds during startup scan. When those log files are deleted after Metro scans but before it can watch them, `fs.watch()` throws ENOENT and crashes Metro. The user experiences this as the app "stuck in a loop" — Metro keeps crashing whenever Expo Go tries to connect.

**How to apply:** Use `localDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")` to properly escape the absolute path before using it in `new RegExp(...)`. The pattern should be `^<escaped-path>(\\/.*)?$` to match the directory and all its children.

## Also fixed alongside this
- `lib/startup.ts`: `STARTUP_FONT_TIMEOUT_MS` reduced from 8000 → 2000ms so the app appears in max 2s even when fonts fail to load from Metro (common when the proxy has issues).
- `.replit` Start Frontend workflow: removed `ensurePreviewReachable = "/status"` — Metro's bundler server doesn't serve that route, causing the Replit health check to always fail and report the workflow as dead even when Metro was running fine.
