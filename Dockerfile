# h2a-cli container image (DEC-060)
#
# Two-stage build:
#   1. `builder` installs all workspace dependencies and runs `tsc -b` to
#      produce the dist/ output of @sentropic/h2a and @sentropic/h2a-cli.
#   2. `runtime` is a minimal alpine image carrying only the built CLI +
#      its production dependency closure, with `h2a` on PATH.
#
# Build locally:
#   docker build -t h2a-cli:dev .
#   docker run --rm h2a-cli:dev --help
#
# In CI (.github/workflows/docker.yml) the same Dockerfile is built and
# pushed to ghcr.io/rhanka/h2a-cli on every vX.Y.Z tag.

FROM node:22-alpine AS builder
WORKDIR /src
# h2a-runtime pulls node-pty; Alpine needs a native build toolchain when no
# matching prebuild is available. Kept in the builder stage only.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/focus/package.json packages/focus/
COPY packages/focus-interactive/package.json packages/focus-interactive/
COPY packages/h2a/package.json packages/h2a/
COPY packages/h2a-cli/package.json packages/h2a-cli/
COPY packages/h2a-runtime/package.json packages/h2a-runtime/
COPY packages/track/package.json packages/track/
RUN npm ci --no-audit --no-fund
COPY packages/focus packages/focus
COPY packages/focus-interactive packages/focus-interactive
COPY packages/h2a packages/h2a
COPY packages/h2a-cli packages/h2a-cli
COPY packages/h2a-runtime packages/h2a-runtime
COPY packages/track packages/track
COPY scripts/clean-workspace-dist.mjs scripts/
RUN npm run build

# ---

FROM node:22-alpine AS runtime
WORKDIR /opt/h2a
# Carry the entire workspace install — node_modules + the two built packages.
# The image is then small enough (~150MB) and the runtime can `node dist/bin.js`
# directly without needing npm at runtime.
COPY --from=builder /src/node_modules /opt/h2a/node_modules
COPY --from=builder /src/packages /opt/h2a/packages

# Make `h2a` resolvable on PATH. The shipped bin already carries the shebang.
RUN ln -s /opt/h2a/packages/h2a/dist/bin.js /usr/local/bin/h2a \
    && chmod +x /opt/h2a/packages/h2a/dist/bin.js

# Non-root user keeps the image safe to use as a sidecar in restricted
# Pod Security Standards namespaces.
RUN addgroup -g 1001 -S h2a && adduser -u 1001 -S h2a -G h2a
USER h2a:h2a

WORKDIR /workspace
ENTRYPOINT ["h2a"]
CMD ["--help"]
