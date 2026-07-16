FROM ubuntu:26.04@sha256:651ba3fe3a830441e3deaf70fafac40d808a6bd2800a6f2c43130055159f23e6

ARG MISE_VERSION

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# version of gnupg does not matter
# hadolint ignore=DL3008
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg git libatomic1 && \
    rm -rf /var/lib/apt/lists/*

# Configure mise environment variables
# ref: https://mise.jdx.dev/mise-cookbook/docker.html
ENV MISE_DATA_DIR="/mise"
ENV MISE_CACHE_DIR="/mise/cache"
ENV MISE_INSTALL_PATH="/usr/local/bin/mise"
ENV MISE_TRUSTED_CONFIG_PATHS="/dotfiles"
ENV MISE_ENABLE_TOOLS=bun,node
ENV MISE_YES=1
ENV PATH="${MISE_DATA_DIR}/shims:${MISE_INSTALL_PATH%/*}:$PATH"

# Install mise with GPG verification and specific version
RUN set -eux && \
    echo "Installing mise version: ${MISE_VERSION}" && \
    # ref: https://mise.jdx.dev/installing-mise.html#https-mise-run
    # use hkp because hkps fails with: gpg: keyserver receive failed: General error
    gpg --keyserver hkp://keyserver.ubuntu.com --recv-keys 0x7413A06D && \
    curl --fail-with-body --location --output install.sh.sig "https://mise.jdx.dev/install.sh.sig" && \
    gpg --decrypt --output install.sh install.sh.sig && \
    sh ./install.sh && \
    rm install.sh.sig install.sh && \
    mise version

# Set git config to suppress hints and warnings
RUN set -eux && \
    git config --global init.defaultBranch main && \
    git config --global advice.detachedHead false

WORKDIR /dotfiles

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
