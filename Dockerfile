FROM node:20-alpine AS web-builder
ARG TARGETARCH
ARG APP_COMMIT_ID
ARG APP_COMMIT_DATE
ENV VITE_APP_COMMIT_ID=$APP_COMMIT_ID VITE_APP_COMMIT_DATE=$APP_COMMIT_DATE
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
# npm lockfiles generated on another OS may omit Rollup's platform package
# (npm/cli#4828). Install exactly the native package for the build target.
RUN --mount=type=cache,target=/root/.npm case "$TARGETARCH" in \
      arm64) npm install --no-save @rollup/rollup-linux-arm64-musl@4.60.1 ;; \
      amd64) npm install --no-save @rollup/rollup-linux-x64-musl@4.60.1 ;; \
      *) echo "Unsupported Docker architecture: $TARGETARCH"; exit 1 ;; \
    esac
COPY frontend/ ./
RUN test -n "$APP_COMMIT_ID" && test "$APP_COMMIT_ID" != "unknown" && test -n "$APP_COMMIT_DATE" && test "$APP_COMMIT_DATE" != "unknown" || (echo "Build metadata missing: use scripts/update-all.sh or pass APP_COMMIT_ID and APP_COMMIT_DATE." >&2; exit 1)
RUN npm run build

FROM rust:1.91-alpine3.23 AS api-builder
ARG RUST_PROFILE=release
WORKDIR /build/backend
COPY backend/provider-core ./provider-core
COPY backend/Cargo.toml ./
COPY backend/Cargo.lock ./
COPY backend/src ./src
RUN --mount=type=cache,id=courrier-cargo-registry,target=/root/.cargo/registry \
    --mount=type=cache,id=courrier-cargo-git,target=/root/.cargo/git \
    --mount=type=cache,id=courrier-cargo-target,target=/build/backend/target \
    case "$RUST_PROFILE" in release|local) ;; *) echo "Unsupported Rust profile: $RUST_PROFILE"; exit 1 ;; esac && \
    cargo build --profile "$RUST_PROFILE" && \
    cp "target/$RUST_PROFILE/courrier-server" /tmp/courrier-server

FROM alpine:3.23
RUN addgroup -S courrier && adduser -S courrier -G courrier
WORKDIR /app
COPY --from=api-builder /tmp/courrier-server /usr/local/bin/courrier-server
COPY --from=web-builder /build/frontend/dist ./web
ENV COURRIER_WEB_ROOT=/app/web PORT=8080 COURRIER_ALLOWED_PROVIDER_HOSTS=""
EXPOSE 8080
USER courrier
CMD ["courrier-server"]
