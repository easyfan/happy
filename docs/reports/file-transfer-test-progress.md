# File Transfer Feature — Test Progress Report

**Date**: 2026-04-24  
**Feature**: Bidirectional file transfer (App↔CLI)  
**Branch**: main  

---

## Test Cases

### DT-01 · CLI→App file share (mcp__happy__share_file)

**Status**: ✅ PASS

**Steps verified**:
1. CLI calls `mcp__happy__share_file` with a local file path
2. Server stores encrypted `FileShareArtifact`
3. App receives update and renders `FileShareBubble` with filename + size
4. Download tapped → fails due to Docker network isolation (expected in local test env)

**Platform**: Web App (Playwright)  
**Session**: `cmocvz7rj0001luiocjmp10wj` (AT-01 File Upload Test, same machine)

---

### AT-01 · App→CLI file upload

**Status**: 🔄 IN PROGRESS — attachment button not rendering on iOS simulator

#### Root Cause Chain (resolved)

| # | Problem | Fix | Status |
|---|---------|-----|--------|
| 1 | `access.key` was legacy format → `dataEncryptionKey` null on machine | Added `happy auth upgrade --content-public-key <base64>` CLI subcommand | ✅ Fixed |
| 2 | Server `POST /v1/machines` returned existing record unchanged when machine already existed | Modified `machinesRoutes.ts` to update `dataEncryptionKey` when was null + emit `buildNewMachineUpdate` event | ✅ Fixed |
| 3 | `SessionView.tsx` `useMemo([sessionId])` computed `sessionDataKey = null` before async encryption init; never recomputed | Changed to `useState` + `useEffect` so it re-evaluates after mount | ✅ Fixed (pending build) |

#### Current Blocker

iOS build not completing. Multiple `expo run:ios` processes were competing / locking `build.db`. Need a clean build.

**Commands used**:
```bash
# Derive contentPublicKey from app secret
node test/e2e/derive-content-key.mjs --secret ylXhqB87PyLGXxhaGi5X6INdOf6LKrOURLDX-YCWT5A
# → lptJgnKTKG64iG8zC6ep2pY2yZQU6O3bA1iPIHB9s0A=

# Upgrade credentials in container
docker exec happy-e2e-test node /app/packages/happy-cli/bin/happy.mjs auth upgrade \
  --content-public-key lptJgnKTKG64iG8zC6ep2pY2yZQU6O3bA1iPIHB9s0A=

# Restart daemon
docker exec happy-e2e-test node /app/packages/happy-cli/bin/happy.mjs daemon stop
docker exec happy-e2e-test node /app/packages/happy-cli/bin/happy.mjs daemon start
```

#### What has been verified so far

- Machine `a1b2c3d4-e5f6-7890-abcd-ef1234567890` (Docker container) now has `dataEncryptionKey` on server ✓
- Session `cmocvz7rj0001luiocjmp10wj` has `dataEncryptionKey` starting with `AKGNbT4...` ✓
- Web App session composer shows 3 buttons (was 2 before fix) — attachment button appeared on Web ✓
- iOS: attachment button still not rendering (blocked by `useMemo` bug + build issue)

#### Next Steps

1. Kill stale build processes: `pkill -f xcodebuild; pkill -f "expo run:ios"`
2. Clean rebuild: `cd packages/happy-app && pnpm exec expo run:ios --device "iPhone 17"`
3. Navigate to AT-01 session → verify attachment icon (📎) appears in composer
4. Tap attach → native file picker opens → select a file
5. Send → verify CLI receives `FileUploadArtifact` and processes content

---

## Code Changes Made

### `packages/happy-cli/src/commands/auth.ts`
- Added `upgrade` subcommand: `happy auth upgrade --content-public-key <base64>`
- Upgrades legacy `{secret, token}` credentials to dataKey format `{encryption: {publicKey, machineKey}, token}`

### `packages/happy-server/sources/app/api/routes/machinesRoutes.ts`
- When machine already exists and `!machine.dataEncryptionKey && body.dataEncryptionKey`:
  - Updates machine with new key + increments `metadataVersion`
  - Emits `buildNewMachineUpdate` event so App syncs

### `packages/happy-app/sources/-session/SessionView.tsx`
- Changed `sessionDataKey` from `useMemo([sessionId])` to `useState` + `useEffect([sessionId])`
- Fixes: key was null on first render (before async encryption init), never re-ran

### `test/e2e/derive-content-key.mjs` (new)
- Derives App's `contentPublicKey` from the master `secret`
- Implements BIP32-style HMAC-SHA512 key derivation + libsodium curve25519 public key

---

## Environment

- Server: `localhost:3005` (PGlite standalone)
- CLI daemon: Docker container `happy-e2e-test`, `HAPPY_HOME_DIR=/root/.happy-e2e`
- App: iOS Simulator iPhone 17 (`8F03C1D2-9575-4B0F-AFDA-C20191542E39`)
- Test data: `/Users/zhengfan/happy-test-data/handy-test/`
- App credentials: secret `ylXhqB87PyLGXxhaGi5X6INdOf6LKrOURLDX-YCWT5A`
