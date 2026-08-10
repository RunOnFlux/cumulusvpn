# CumulusVPN payments bridge — operator-run service (NEVER a Flux app: it
# holds the treasury WIF and Stripe secrets, and Flux spec env is readable by
# every node operator).
# Build:  docker build -t ghcr.io/runonflux/cumulusvpn-bridge:0.1.0 .
# Run:    docker run -v bridge-data:/data --env-file .env ghcr.io/runonflux/cumulusvpn-bridge

# ---- build stage ------------------------------------------------------------
FROM node:24-bookworm-slim AS build

WORKDIR /app

# better-sqlite3 / secp256k1 build from source when no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock .yarnrc.yml* ./
RUN corepack enable && yarn install --immutable

COPY tsconfig.json ./
COPY src ./src
RUN yarn build

# ---- runtime stage ----------------------------------------------------------
FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY certs ./certs

# Payment/idempotency ledger — MUST be a persistent volume; losing it can
# double-pay in-flight grants after a restart.
# chown BEFORE the VOLUME directive: a fresh named volume copies this
# directory's ownership, and the service runs as `node` — root-owned /data
# means "unable to open database file" at boot.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
ENV DB_PATH=/data/bridge.db

EXPOSE 8080
USER node
ENTRYPOINT ["node", "dist/index.js"]
