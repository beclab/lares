# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates g++ make python3 \
  && rm -rf /var/lib/apt/lists/*
COPY packages/package.json packages/package-lock.json ./
RUN npm ci
COPY packages/ ./
RUN npm run build \
  && npm prune --omit=dev \
  && date -u +%Y%m%d%H%M%S > .dina-image-id

FROM node:22-bookworm-slim
# build-essential + python3: community dsh plugins (e.g. dsh-better-sidebar →
# node-pty) have no linux prebuilds and compile via node-gyp at profile install
# time. The cluster forbids root pods, so the toolchain must live in the image
# and the boot-time `npm install` runs as uid 1000 with build scripts enabled.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates fd-find git ripgrep tini build-essential python3 \
  && ln -sf "$(command -v fdfind)" /usr/local/bin/fd \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
  PORT=8080 \
  HOSTNAME=0.0.0.0 \
  HOME=/data/home \
  DINA_WORKSPACE=/data/workspace \
  DINA_DATA_DIR=/data/dina \
  LLM_GATEWAY_URL=http://router-svc.router-shared/v1 \
  OLARES_APP_ID=dina \
  DINA_CLI_ROOT=/data/cli

USER root
RUN npm install -g @olares/cli@1.12.7-cli.0 \
  && ln -sf "$(npm root -g)/@olares/cli/bin/olares-cli.js" /usr/local/bin/olares-cli \
  && olares-cli -v

# Ship pre-built server + nested dsh packages + production deps.
COPY --from=build --chown=node:node /app/.dina-image-id ./
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --from=build --chown=node:node /app/bundle-web ./bundle-web
COPY --from=build --chown=node:node /app/client-dina ./client-dina
COPY --from=build --chown=node:node /app/skills ./skills

RUN mkdir -p /data/home /data/dina /data/workspace /data/cli \
  && chown -R node:node /data

USER node
VOLUME ["/data"]
EXPOSE 8080

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start"]
