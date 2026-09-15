# syntax=docker/dockerfile:1.7
# The WEAVR curator agent: the fork image plus the curator profile and plugin
# from composable-portfolios-ops (integrations/claw-agent), baked at build
# time so the running VM needs no git credentials. /opt/weavr/profile is the
# whole $HERMES_HOME the ops repo owns; cont-init.d/03-weavr-curator-profile
# re-stamps it over the data volume at every start, keeping the agent's state.
ARG BASE_IMAGE=intothefathom/claw-agent:dev
FROM ${BASE_IMAGE}

ARG OPS_REPO=desync-labs/composable-portfolios-ops
ARG OPS_REF=dev

USER root
# The token reaches git through a credential helper, never through argv or
# the image layers; the clone directory is removed in the same layer.
RUN --mount=type=secret,id=gh_token,required=true set -eu; \
    git -c credential.helper='!f() { printf "username=x-access-token\npassword=%s\n" "$(cat /run/secrets/gh_token)"; }; f' \
        clone --quiet --depth 1 --branch "${OPS_REF}" "https://github.com/${OPS_REPO}.git" /tmp/ops; \
    install -d -m 0755 /opt/weavr/plugins; \
    cp -a /tmp/ops/integrations/claw-agent/profiles/weavr-curator /opt/weavr/profile; \
    cp -a /tmp/ops/integrations/claw-agent/plugins/weavr-curator /opt/weavr/plugins/weavr-curator; \
    printf '%s %s\n' "$(git -C /tmp/ops rev-parse HEAD)" "${OPS_REF}" > /opt/weavr/ops-revision; \
    rm -rf /tmp/ops; \
    chmod -R a+rX,go-w /opt/weavr

COPY --chmod=0755 cont-init.d/03-weavr-curator-profile /etc/cont-init.d/03-weavr-curator-profile

# A failed profile stamp halts the container instead of starting a gateway on
# whatever the volume held before (fail closed).
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2
