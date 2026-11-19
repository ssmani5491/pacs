# OHIF Viewer — pinned source build at a stable release tag.
#
# Why a source build (not the prebuilt ohif/app image)?
#   OHIF bakes its base path (PUBLIC_URL) into the bundle AT BUILD TIME. The
#   prebuilt ohif/app:v3.13.14 image is built for "/", so it cannot be served
#   under /viewer/. We therefore build from the official repo at the SAME pinned
#   tag with PUBLIC_URL=/viewer/. Same upstream source, same version, just the
#   one documented build-arg so the viewer lives at http://localhost/viewer/.
#
# Pin: v3.13.14 (latest stable per github.com/OHIF/Viewers releases, 2026-11-03).

# ---- build stage ----
FROM node:24.22.2-slim AS builder

# OHIF's build needs build tooling + python for native deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential python3 git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@12

ARG OHIF_REF=v3.13.14
ARG PUBLIC_URL=/viewer/
ENV PUBLIC_URL=${PUBLIC_URL}
# QUICK_BUILD trims some long-tail work the upstream Dockerfile also skips.
ENV QUICK_BUILD=true
# Give the build enough heap for the large OHIF bundle.
ENV NODE_OPTIONS=--max-old-space-size=4096

WORKDIR /src
# Shallow clone the exact pinned tag (reproducible, no history).
RUN git clone --depth 1 --branch ${OHIF_REF} https://github.com/OHIF/Viewers.git .

# .dockerignore in the repo excludes docs; a frozen install would fail, so match
# upstream and allow lockfile drift.
RUN pnpm install --no-frozen-lockfile

RUN pnpm run build

# ---- runtime stage ----
# Use the standard nginx alpine (not unprivileged) so our compose healthcheck and
# config mount behave predictably on the shared pacs network.
FROM nginx:1.27-alpine AS final

ARG PUBLIC_URL=/viewer/

# Serve the built viewer under the same subpath it was built for.
COPY --from=builder /src/platform/app/dist /usr/share/nginx/html${PUBLIC_URL}

# Minimal nginx config: serve the SPA under /viewer/ with history-API fallback.
COPY ohif-nginx.conf /etc/nginx/conf.d/default.conf

# app-config.js is provided at runtime via a bind mount (see docker-compose).
# Placeholder so the path exists even if the mount is ever absent.
RUN touch /usr/share/nginx/html${PUBLIC_URL}app-config.js

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=10 --start-period=10s \
  CMD wget -qO- http://127.0.0.1/viewer/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
