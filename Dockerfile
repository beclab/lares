# syntax=docker/dockerfile:1.7
# App image: compile and ship Lares code on top of the environment image.
# Default `scripts/build-image.sh` rebuilds only this file.
ARG BASE_IMAGE=docker.io/beclab/lares-base:21
FROM ${BASE_IMAGE}

USER root
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json tsconfig.server.json ./
COPY scripts/build-client.mjs ./scripts/
COPY packages/ ./packages/
RUN mkdir -p node_modules/@olares \
  && ln -sfn ../../packages/core node_modules/@olares/lares-core

# The olares-* skills are not in git: they belong to the olares-cli in the base
# image, and a hand-copied snapshot describes verbs some other release has.
# This writes them beside the lares-* skills. ha-* is downloaded at runtime
# from hass-cli (Settings → Skills), never copied from git.
RUN olares-cli skills export packages/skills

# vue/vite land here, not in the base image: the phone shell is built in this
# layer. Drop the extra install once the base image's npm ci includes them.
RUN npm install --no-save --no-package-lock --ignore-scripts --no-audit --no-fund --include=dev vue vite @vitejs/plugin-vue sentencex \
  && npm run build \
  && rm -rf packages/service \
  && date -u +%Y%m%d%H%M%S > .lares-image-id \
  && chown -R node:node /app

USER node
# Overrides the base image's `npm run start`: the hot-reload supervisor is
# reloaded with SIGHUP, and npm does not forward that to the script it spawns.
# This way tini's child is the supervisor itself.
CMD ["node", "dist/service/launch.js"]
