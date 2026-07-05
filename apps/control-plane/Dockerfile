FROM node:22-alpine AS builder
WORKDIR /workspace
ENV CI=true

# Copy workspace metadata first to leverage the layer cache.
# Monorepo h2a context: control-plane only needs remote-protocol +
# remote-k8s-orchestrator (the other remote packages were not absorbed).
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/control-plane/package.json apps/control-plane/
COPY packages/remote-protocol/package.json packages/remote-protocol/
COPY packages/remote-k8s-orchestrator/package.json packages/remote-k8s-orchestrator/

RUN corepack enable && \
    corepack prepare npm@11.14.1 --activate && \
    npm install --workspaces --include-workspace-root --ignore-scripts

COPY packages/remote-protocol/ packages/remote-protocol/
COPY packages/remote-k8s-orchestrator/ packages/remote-k8s-orchestrator/
COPY apps/control-plane/ apps/control-plane/

RUN npm run build -w @sentropic/remote-protocol \
 && npm run build -w @sentropic/remote-k8s-orchestrator \
 && npm run build -w @sentropic/remote-control-plane

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0
COPY --from=builder /workspace/package.json /workspace/package-lock.json ./
COPY --from=builder /workspace/apps/control-plane/package.json apps/control-plane/
COPY --from=builder /workspace/apps/control-plane/dist apps/control-plane/dist
COPY --from=builder /workspace/packages/remote-protocol/package.json packages/remote-protocol/
COPY --from=builder /workspace/packages/remote-protocol/dist packages/remote-protocol/dist
COPY --from=builder /workspace/packages/remote-k8s-orchestrator/package.json packages/remote-k8s-orchestrator/
COPY --from=builder /workspace/packages/remote-k8s-orchestrator/dist packages/remote-k8s-orchestrator/dist
RUN corepack enable && \
    corepack prepare npm@11.14.1 --activate && \
    npm install --workspaces --include-workspace-root --omit=dev --ignore-scripts
EXPOSE 8080
CMD ["node", "apps/control-plane/dist/index.js"]
