# syntax=docker/dockerfile:1.7
# App image: compile and ship Lares code on top of the environment image.
# Default `scripts/build-image.sh` rebuilds only this file.
ARG BASE_IMAGE=docker.io/luolong01/lares-base:1
FROM ${BASE_IMAGE}

USER root
WORKDIR /app

COPY tsconfig.base.json tsconfig.server.json ./
COPY scripts/build-client.mjs ./scripts/
COPY packages/ ./packages/

# The olares-* skills are not in git: they belong to the olares-cli in the base
# image, and a hand-copied snapshot describes verbs some other release has.
# This writes the twelve of them beside the ha-* skills, which are ours.
RUN olares-cli skills export packages/skills

RUN npm run build \
  && rm -rf packages/service \
  && date -u +%Y%m%d%H%M%S > .lares-image-id \
  && chown -R node:node /app

USER node
