FROM ghcr.io/jdx/mise:2026.9.12@sha256:868b004119abb2e7c146618da63371ec65da40bfb0f38a0ec4128ca9e96c057a AS mise

FROM ubuntu:26.04@sha256:da6fc2be547864451aa253836dd926da33623312df4a9a243e35dc877c378a78

ARG MISE_VERSION

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# hadolint ignore=DL3008
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates git libatomic1 && \
    rm -rf /var/lib/apt/lists/*

COPY --from=mise /usr/local/bin/mise /usr/local/bin/mise

# Configure mise environment variables
# ref: https://mise.jdx.dev/mise-cookbook/docker.html
ENV MISE_DATA_DIR="/mise"
ENV MISE_CACHE_DIR="/mise/cache"
ENV MISE_TRUSTED_CONFIG_PATHS="/dotfiles"
ENV MISE_ENABLE_TOOLS=bun,node
ENV MISE_YES=1
ENV PATH="${MISE_DATA_DIR}/shims:$PATH"

# CI and Compose derive MISE_VERSION from mise.toml's min_version. A digest
# selects the binary even if its tag changes, so fail on version drift.
RUN set -eux && \
    actual_version="$(mise --version)" && \
    if [ "${actual_version%% *}" != "${MISE_VERSION:?MISE_VERSION is required}" ]; then \
        echo "mise image version ${actual_version} does not match MISE_VERSION=${MISE_VERSION}; update the image tag and digest together." >&2; \
        exit 1; \
    fi

# Set git config to suppress hints and warnings
RUN set -eux && \
    git config --global init.defaultBranch main && \
    git config --global advice.detachedHead false

WORKDIR /dotfiles

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
