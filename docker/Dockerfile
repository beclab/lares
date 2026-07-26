FROM node:24-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build


FROM node:24-slim AS runtime

# git, ripgrep and fd back pi's built-in tools; without them the agent silently
# loses grep/find capability at runtime.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates fd-find git ripgrep tini \
	&& ln -s "$(command -v fdfind)" /usr/local/bin/fd \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
RUN npm ci --omit=dev --include-workspace-root -w @lares/shared -w @lares/server \
	&& npm cache clean --force

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/web/dist ./web
COPY docker/entrypoint.sh /usr/local/bin/lares-entrypoint
RUN chmod +x /usr/local/bin/lares-entrypoint

ENV PORT=30141 \
	HOST=0.0.0.0 \
	HOME=/data/home \
	PI_CODING_AGENT_DIR=/data/pi/agent \
	LARES_WORKSPACE=/data/workspace \
	LARES_WEB_ROOT=/app/web \
	LLM_GATEWAY_URL=http://llm-gateway-backend.os-framework:8080/v1 \
	PI_SKIP_VERSION_CHECK=1

# Olares runs app containers as uid 1000 and hands them uid-1000 storage. Owning
# /data in the image also makes a plain `docker run -v` mount usable, because
# Docker seeds a fresh volume from the image directory's ownership.
RUN mkdir -p /data/home && chown -R node:node /data
USER node

VOLUME ["/data"]
EXPOSE 30141

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/lares-entrypoint"]
