# syntax=docker/dockerfile:1.7
# The weavr agent image: this fork (built with the upstream Dockerfile, passed
# in as BASE_IMAGE) plus what the weavr layer needs at run time — the wallet
# tool's node modules and the PayBox CLI, the weavr skill, the host brief, the
# stamp that builds $HERMES_HOME at every start, and the signer entrypoint.
# One image serves both containers of weavr/docker-compose.yml.
ARG BASE_IMAGE=hermes-base:local
FROM ${BASE_IMAGE}

ARG SKILL_URL=https://api.weavr.sh/hosts/hermes/SKILL.md

USER root
# The layer as of this commit, whatever commit the base was built from.
COPY --chmod=a+rX,go-w weavr/ /opt/hermes/weavr/
RUN cd /opt/hermes/weavr && \
    npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force && \
    chmod -R a+rX,go-w /opt/hermes/weavr

RUN install -d -m 0755 /opt/weavr/skills/weavr && \
    curl -fsS --retry 3 "${SKILL_URL}" -o /opt/weavr/skills/weavr/SKILL.md && \
    chmod 0644 /opt/weavr/skills/weavr/SKILL.md
COPY --chmod=0644 weavr/AGENTS.md /opt/weavr/AGENTS.md

COPY --chmod=0755 weavr/docker/cont-init.d/016-weavr-agent /etc/cont-init.d/016-weavr-agent
COPY --chmod=0755 weavr/docker/weavr-signer weavr/docker/paybox-setup /usr/local/bin/

# Mount points of the signer container: the PayBox config and key, and the
# socket the two containers share. Owned by the hermes user (10000) so the
# named volumes inherit it.
RUN install -d -o hermes -g hermes -m 0700 /paybox && \
    install -d -o hermes -g hermes -m 0770 /run/weavr

ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    WEAVR_SIGN_TOOL=/opt/hermes/weavr/tools/sign-proxy.mjs \
    WEAVR_MANIFEST=/opt/hermes/weavr/manifest.json
