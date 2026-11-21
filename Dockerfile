# An optional named build context supplies verified wheels for offline builds.
FROM scratch AS wheelhouse

FROM ubuntu:26.04@sha256:d66b366dac61b575bee2aef07e9c26e8070096fbe84a3d4d3eb0da069b5d76db AS python-build

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        build-essential ca-certificates curl xz-utils \
        libbz2-dev libffi-dev liblzma-dev libncurses-dev libreadline-dev \
        libsqlite3-dev libssl-dev libzstd-dev uuid-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# GNU tar's openat2 extraction is unavailable under some Mac AMD64 emulators.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends libarchive-tools \
    && rm -rf /var/lib/apt/lists/*

# Use the upstream maintenance release without importing another distribution's binaries.
RUN --mount=type=bind,from=wheelhouse,target=/tmp/wheels \
    if [ -f /tmp/wheels/Python-3.14.10.tar.xz ]; then \
      cp /tmp/wheels/Python-3.14.10.tar.xz /tmp/python.tar.xz; \
    else \
      curl --fail --location --retry 5 --connect-timeout 20 --max-time 300 \
        https://www.python.org/ftp/python/3.14.10/Python-3.14.10.tar.xz -o /tmp/python.tar.xz; \
    fi \
    && echo 'de414a57119abef52784d8993e341d53aed635fc2b05c2607d9f98a2c5b72032  /tmp/python.tar.xz' | sha256sum --check \
    && mkdir /tmp/python-source \
    && bsdtar -xf /tmp/python.tar.xz -C /tmp/python-source --strip-components 1

WORKDIR /tmp/python-source
RUN LDFLAGS='-Wl,-rpath=/opt/python/lib' ./configure \
        --prefix=/opt/python --enable-shared --without-static-libpython \
        --disable-test-modules --with-ensurepip=install \
    && make -j4 \
    && make install \
    && /opt/python/bin/python3 --version

FROM ubuntu:26.04@sha256:d66b366dac61b575bee2aef07e9c26e8070096fbe84a3d4d3eb0da069b5d76db AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SOFFICE_PATH=/usr/bin/soffice \
    PATH=/opt/valux-venv/bin:$PATH

RUN apt-get update \
    && apt-get upgrade -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates tzdata libbz2-1.0 libffi8 liblzma5 libncursesw6 \
        libreadline8t64 libsqlite3-0 libssl3t64 libuuid1 libzstd1 zlib1g \
        libreoffice-core-nogui libreoffice-writer-nogui libreoffice-calc-nogui \
        fonts-dejavu-core fonts-liberation fonts-crosextra-carlito \
    && rm -f /usr/bin/pebble \
    && rm -rf /var/lib/apt/lists/*

COPY --from=python-build /opt/python /opt/python
RUN /opt/python/bin/python3 -m venv /opt/valux-venv

WORKDIR /app
COPY requirements.txt /tmp/requirements.txt
RUN --mount=type=bind,from=wheelhouse,target=/tmp/wheels \
    if [ -f /tmp/wheels/requirements.lock ]; then \
      python -m pip install --no-cache-dir --no-index --only-binary=:all: \
        --find-links=/tmp/wheels --require-hashes \
        -r /tmp/wheels/requirements.lock \
        && python -m pip install --no-index -r /tmp/requirements.txt; \
    else \
      for attempt in 1 2 3 4 5; do \
        python -m pip install --no-cache-dir --timeout 300 --retries 10 -r /tmp/requirements.txt && break; \
        if [ "$attempt" -eq 5 ]; then exit 1; fi; \
        echo "Dependency download failed (attempt ${attempt}/5); retrying."; \
      done; \
    fi \
    && python -m pip check \
    && python -m pip uninstall --yes pip

# Pip/ensurepip are build tools, not app runtime dependencies.
RUN /opt/python/bin/python3 -m pip uninstall --yes pip \
    && rm -rf /opt/python/lib/python3.14/ensurepip

COPY backend /app/backend
COPY frontend /app/frontend
COPY resources /app/resources

ARG VALUX_SOURCE_FINGERPRINT
LABEL org.opencontainers.image.title="ValuX Property Reports" \
    io.valux.source-fingerprint="${VALUX_SOURCE_FINGERPRINT}"

EXPOSE 4173
CMD ["python", "-m", "backend.server"]
