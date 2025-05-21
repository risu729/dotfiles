FROM ubuntu:24.04

ARG MISE_VERSION_ARG

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Configure mise environment variables
# ref: https://mise.jdx.dev/mise-cookbook/docker.html
ENV MISE_DATA_DIR="/mise"
ENV MISE_CONFIG_DIR="/mise"
ENV MISE_CACHE_DIR="/mise/cache"
ENV MISE_INSTALL_PATH="/usr/local/bin/mise"
ENV MISE_VERSION=${MISE_VERSION_ARG}
ENV PATH="${MISE_DATA_DIR}/shims:${MISE_INSTALL_PATH%/*}:$PATH"

# Install mise with GPG verification and specific version
RUN set -eux && \
    echo "Installing mise version: ${MISE_VERSION}" && \
    # ref: https://mise.jdx.dev/installing-mise.html#https-mise-run
    # cspell:ignore hkps keyserver
    gpg --keyserver hkps://keyserver.ubuntu.com --recv-keys 0x7413A06D && \
    script=$(curl --fail-with-body --location "https://mise.jdx.dev/install.sh.sig") && \
    echo "${script}" | gpg --decrypt > install.sh && \
    sh ./install.sh && \
    mise version

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
