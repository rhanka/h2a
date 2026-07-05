FROM node:22-alpine AS builder
WORKDIR /workspace
ENV CI=true

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/llm-gateway/package.json apps/llm-gateway/

RUN corepack enable && \
    corepack prepare npm@11.14.1 --activate && \
    npm install --workspaces --include-workspace-root --ignore-scripts

COPY apps/llm-gateway/ apps/llm-gateway/

RUN npm run build -w @sentropic/remote-llm-gateway

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3002 \
    HOST=0.0.0.0
COPY --from=builder /workspace/package.json /workspace/package-lock.json ./
COPY --from=builder /workspace/apps/llm-gateway/package.json apps/llm-gateway/
COPY --from=builder /workspace/apps/llm-gateway/dist apps/llm-gateway/dist
RUN corepack enable && \
    corepack prepare npm@11.14.1 --activate && \
    npm install --workspaces --include-workspace-root --omit=dev --ignore-scripts
EXPOSE 3002
CMD ["node", "apps/llm-gateway/dist/index.js"]
