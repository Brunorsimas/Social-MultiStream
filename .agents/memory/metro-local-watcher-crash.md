---
name: Metro FallbackWatcher crash and dev landing page
description: Why Metro crashes with ENOENT on Replit, how to fix it, and how the dev landing page works.
---

## Metro ENOENT crash

The `metro.config.js` blockList regex must use correct escaping. The original code used `path.join(__dirname, "\\.local")` which on Linux produces `/workspace/\.local` (literal backslash) — a path that never exists, so `.local` was never excluded. Metro's FallbackWatcher called `fs.watch()` on volatile Replit log files in `.local/state/workflow-logs/`. When those files were deleted at runtime, `fs.watch()` threw ENOENT and crashed Metro. The user experiences this as an app "stuck in a loop" — Metro crashes whenever Expo Go tries to connect.

**Fix:** Use `localDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")` to properly escape the absolute path, then `^<escaped-path>(\\/.*)?$` as the pattern.

## Metro `Invalid URL` behind the Replit proxy

Setting `xfwd: false` prevents `http-proxy` from creating another forwarding
layer, but it does not remove malformed headers already received from an
upstream proxy. Metro prefers `x-forwarded-host` and `x-forwarded-proto` when it
constructs request URLs, so comma-separated values still cause `TypeError:
Invalid URL` and HTTP 500 responses for bundles or assets.

**Fix:** Override `host`, `x-forwarded-host`, and `x-forwarded-proto` on both
HTTP and WebSocket proxy requests with the single validated public origin.

## Stale Expo CLI installation

The captured SHA-1 error points to
`node_modules/expo/node_modules/@expo/cli/...`, while the lockfile hoists the
active Expo CLI to `node_modules/@expo/cli`. This indicates a stale dependency
tree rather than an invalid image asset. The post-merge setup must use `npm ci`
so `node_modules` is recreated from the lockfile before Metro starts.

## Development landing page (QR code visibility)

In development, the backend (port 5000) acts as a full Metro proxy, including `GET /`. This means the browser sees Metro's raw debug UI, not the styled landing page with QR code (that page is production-only). The fix adds a `configureDevelopmentLandingPage` route for `GET /` in development.

**Critical:** The proxy's `pathFilter` must forward `GET /` requests that carry the `expo-platform` header (Expo Go manifest requests) to Metro, but skip the proxy for plain browser requests (no header) so the landing page is served. If both are served the landing page, Expo Go can't get its manifest.

## Also fixed

- `lib/startup.ts`: `STARTUP_FONT_TIMEOUT_MS` reduced 8000 → 2000ms (font proxy issues cause 8s blank screen).
- `.replit` Start Frontend workflow: removed `ensurePreviewReachable = "/status"` — Metro doesn't serve that route; the Replit health check always failed even when Metro was running fine. Fixed by calling `configureWorkflow` (outputType console, waitForPort 8081).
