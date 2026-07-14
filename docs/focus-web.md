# Focus Web

`h2a focus serve` runs the production SvelteKit Focus app shipped inside `@sentropic/h2a`. `h2a focus web` is its exact alias. The command does not require the h2a monorepo and never falls back to `vite`, `npm run dev`, or generated development-server instructions.

```bash
# Nearest ancestor containing .track/events.jsonl; loopback by default.
h2a focus serve

# Explicit target and collision-free port.
h2a focus serve --repo /work/project --port 0
```

The command prints the exact URL after the HTTP listener is ready and remains in the foreground until stopped. It closes gracefully on `SIGINT`, `SIGTERM`, and `SIGHUP`.

## Resolution and network

Repository precedence is `--repo`, `FOCUS_REPO_ROOT`, then the nearest ancestor containing `.track/events.jsonl`. Events precedence is `--track-events`, `FOCUS_TRACK_EVENTS`, then `<repo>/.track/events.jsonl`. Paths are canonicalized and must be readable before the server starts.

The default bind is `127.0.0.1:5178`. In loopback mode h2a rejects non-loopback `Host` headers to limit DNS-rebinding access. A non-loopback `--host` is an explicit, warned exposure of an unauthenticated repository view. Port `0` asks the OS for an available port.

## Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/` | `GET` | Server-rendered Focus backlog, decisions, recommendations, and completed work. |
| `/_app/*` | `GET` | Hashed production client assets included in `@sentropic/h2a`. |
| `/api/actions/launch` | `POST` | Validate a selected set of launchable directive ids. Real agent launch remains explicitly unwired. |
| `/api/decisions/inject` | `POST` | Deliver a decision mandate to a live h2a session when one is available. |

The app first uses a built `packages/track/dist/index.js` in the target checkout when present, then falls back to the installed `@sentropic/track` dependency. h2a passes `FOCUS_REPO_ROOT`, `FOCUS_TRACK_EVENTS`, and its installed binary path to the server. When `H2A_INSTANCE` is present, h2a also maps it to `FOCUS_EMITTER_INSTANCE` so decision injection can prefer the serving live session.

## Packaging safety

The published package includes `focus-app/` with a versioned compatibility manifest, adapter-node handler, server chunks, and client assets. Startup fails closed when the artifact is absent, incomplete, incompatible, or lacks a declared runtime dependency. The prepack check additionally rejects a stale artifact or an undeclared generated runtime dependency.

To refresh the committed artifact after changing `apps/focus`:

```bash
npm ci --prefix apps/focus
npm run build:focus-app
npm run check:focus-app
```
