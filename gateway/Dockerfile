# CumulusVPN gateway — reproducible, tiny, static image.
# Build:  docker build -t ghcr.io/runonflux/cumulusvpn-gateway:0.2.0 .
# CI (.github/workflows/gateway-image.yml) is the source of truth for published
# tags; a local build is for testing only and pushes nothing.
# The build is reproducible: both base images below are pinned by tag AND digest,
# and CI pins SOURCE_DATE_EPOCH, so the published image digest verifiably matches
# this source (docs/03-gateway.md "Container image").
# Dependabot's docker ecosystem (.github/dependabot.yml, /gateway) keeps both
# FROM lines updated — it bumps the tag and the digest together in one PR.

# ---- build stage ------------------------------------------------------------
# Matches the `toolchain` line in go.mod (go1.27.2). The image runs with
# GOTOOLCHAIN=local, so it must also be >= the go directive (go 1.26.0), else the
# build fails with "go.mod requires go >= …". Bump this and go.mod together.
FROM golang:1.27.2-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS build

# Reproducibility: fixed module cache + trimmed paths + no VCS stamping.
ENV CGO_ENABLED=0 \
    GOFLAGS=-trimpath \
    GOOS=linux

WORKDIR /src

# Cache deps first.
COPY go.mod go.sum* ./
RUN go mod download

COPY . .

# SOURCE_DATE_EPOCH lets CI stamp a deterministic build time.
ARG SOURCE_DATE_EPOCH=0
ARG TARGETARCH=amd64
# GIT_COMMIT (the FULL sha; CI passes github.sha) is stamped into /v1/info so the
# fleet dashboard can flag out-of-date instances — the semver tag doesn't change
# between rebuilds, and api.Version is a const CI cannot stamp. Defaults to "dev".
ARG GIT_COMMIT=dev
RUN GOARCH=${TARGETARCH} go build \
        -trimpath \
        -buildvcs=false \
        -ldflags "-s -w -buildid= -X github.com/runonflux/cumulusvpn-gateway/internal/api.BuildCommit=${GIT_COMMIT}" \
        -o /out/gateway ./cmd/gateway

# ---- runtime stage ----------------------------------------------------------
# distroless/static gives us CA certs (for HTTPS to the explorer fallback) and
# a nonroot user, staying ~2 MB over scratch. Swap for `FROM scratch` if you
# vendor CA certs yourself and never hit the public explorer.
FROM gcr.io/distroless/static:nonroot@sha256:d62067879de890a1def9da0e7766b7d20810a5e5555cef8506b752437d7a3e88

COPY --from=build /out/gateway /gateway

# Listeners (docs/15-transports.md). Two port NUMBERS carry all three transports,
# because Flux publishes both the TCP and UDP side of every port in a spec:
#   51820/udp  vanilla WireGuard          (transport "wg", always on)
#   51820/tcp  WireGuard-over-TLS relay   (transport "wg-tls", CVPN_TLS_ENABLE;
#              the cumulusvpntls<cc> stealth group sets CVPN_TLS_PORT=443 and the
#              relay listens there instead — conditional, so not EXPOSEd here)
#   51821/tcp  control API
#   51821/udp  AmneziaWG obfuscated       (transport "awg", CVPN_OBFS_ENABLE)
# 51822/udp — the premium-gated WG device behind the TLS relay — is deliberately
# absent and must NEVER reach a Flux spec's ports[] (internal/config/config.go).
#
# EXPOSE is image metadata only: FluxOS derives published ports from the on-chain
# app spec, not from the image, so this block documents rather than binds.
EXPOSE 51820/udp
EXPOSE 51820/tcp
EXPOSE 51821/tcp
EXPOSE 51821/udp

# Peer/key cache. Mount a Flux volume here for identity persistence.
VOLUME ["/data"]

USER nonroot:nonroot
ENTRYPOINT ["/gateway"]
