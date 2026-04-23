# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Happy is a mobile/web client for remotely controlling Claude Code sessions with end-to-end encryption. Three components work together:

1. **happy-cli** — CLI wrapper that runs on the developer's machine, integrating with Claude Code via SDK or PTY
2. **happy-server** — Fastify backend handling encrypted sync, WebSocket sessions, and auth
3. **happy-app** — React Native + Expo client (iOS, Android, web, macOS/Tauri)

Shared message types live in **happy-wire**. Each package has its own CLAUDE.md with detailed guidance.

## Monorepo Commands (root)

```bash
yarn cli           # Run Happy CLI
yarn web           # Run Happy App web
yarn env:*         # Environment management (new, list, use, remove, current, server, web)
```

## Per-Package Commands

### happy-cli (`packages/happy-cli/`)
```bash
yarn build                  # tsc + pkgroll
yarn test                   # Vitest
yarn dev:local-server       # Run against local server (.env.dev-local-server)
yarn dev:daemon:start       # Start daemon in dev mode
yarn typecheck
```

### happy-server (`packages/happy-server/`)
```bash
yarn standalone:dev         # PGlite + .env.dev — recommended for local dev (port 3005)
yarn test                   # Vitest
yarn generate               # Regenerate Prisma client after schema changes
yarn build                  # TypeScript type checking only
```
Only two env vars needed for standalone: `HANDY_MASTER_SECRET` and `PORT`.

### happy-app (`packages/happy-app/`)
```bash
yarn web                    # Web dev server
yarn ios / yarn android     # Simulator
yarn typecheck              # Run after every change
yarn ota                    # Deploy OTA update to production
npx tsx sources/scripts/parseChangelog.ts  # Regenerate changelog.json after editing CHANGELOG.md
```

## High-Level Architecture

### Security & Transport
- End-to-end encryption: TweetNaCl (CLI) / libsodium (app) — data encrypted before leaving device
- QR-code challenge-response authentication
- Keys stored at `~/.handy/access.key` with restricted permissions
- Socket.IO for real-time WebSocket messaging; optimistic concurrency for distributed state

### CLI Session Modes
- **Interactive mode**: node-pty spawns Claude in a PTY; file watcher reads session `.jsonl` files
- **Remote mode**: `@anthropic-ai/claude-code` SDK handles sessions directly
- MCP (Model Context Protocol) server intercepts permission requests and forwards to mobile
- `--resume` creates a new session ID (all history is copied under the new ID)
- Daemon logs: `~/.happy-dev/logs/YYYY-MM-DD-HH-MM-SS-daemon.log`

### Server
- Fastify 5 + Prisma ORM; PostgreSQL in prod, PGlite (embedded) for standalone dev
- Event bus: local or Redis-backed pub/sub; use `afterTx` to emit events post-commit
- DB operations belong in dedicated action files under `sources/app/<entity><Action>.ts` (e.g., `friendAdd.ts`)
- **Never run migrations yourself** — only humans run `yarn migrate`
- Use `privacyKit.decodeBase64` / `encodeBase64`, not raw Buffer

### App
- Expo Router v6 for file-based navigation; app screens in `sources/app/(app)/`
- Unistyles for theming; `StyleSheet.create` from `react-native-unistyles` for all styles
- **Never use React Native `Alert`** — use `Modal` from `@sources/modal/index.ts`
- **Always use `useHappyAction`** (`@sources/hooks/useHappyAction.ts`) for async operations (handles errors automatically)
- **Always use `t()`** from `@/text` for every user-visible string; add to all 9 language files when adding new keys
- Use `ItemList` for most list containers; `Avatar` for avatars; `AsyncLock` for exclusive async locks
- Set screen params in `_layout.tsx`, not individual pages
- Always wrap pages in `memo`; place styles at bottom of file
- Web hotkeys: `useGlobalKeyboard` only
- No backward compatibility

## Code Style (all packages)

- **Yarn** only (not npm)
- **4 spaces** indentation
- `@/` path alias for all internal imports; absolute imports only; all imports at top of file
- No classes unless unavoidable; functional/declarative patterns
- No small getters/setters; avoid excessive `if` chains
- Tests colocated: `.test.ts` (CLI), `.spec.ts` (server)
- Tests use real APIs — no mocking
- Do not add logging unless asked
- Do not return values from action functions "just in case"

## Tencent Cloud Docker Build Rules

**Before writing or modifying any Dockerfile intended to build on the Tencent Cloud server**, verify ALL external download points use domestic CN mirrors. Missing even one will cause the build to hang or fail mid-way.

Required mirrors for every Dockerfile:

| Download point | Mirror |
|----------------|--------|
| apt (`deb.debian.org`) | `mirrors.cloud.tencent.com` |
| npm/pnpm registry | `https://registry.npmmirror.com` |
| node-gyp node headers (`nodejs.org`) — **GFW blocked** | `ENV npm_config_disturl=https://npmmirror.com/mirrors/node` |
| corepack pnpm binary | `ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com` |
| Prisma engines (`binaries.prisma.sh`) | `ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma` |

Use `Dockerfile.server` as the reference template — all mirrors are declared as `ARG` at the top.

## Project Reports & Deep Docs

`docs/reports/` contains in-depth reports on completed work — read when context about past decisions or practices is needed:

- `docs/reports/ai-driven-development-flow.md` — Full AI-driven SDLC case study: requirements → design → coding → unit tests → functional tests (35 cases, 3 platforms) → ops monitoring → release. Covers easybot-mail monitoring design, P1/P2 risk checklist, fork release strategy (EAS bypass), Version 9 file transfer launch.
