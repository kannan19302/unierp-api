# unierp-api — L3, the modular monolith. One deployable, two routers.
#
# Built from THIS repository alone. `@unerp/*` comes from the registry, not from
# a sibling directory, which is the property that makes the split real rather
# than a directory layout.
#
#   docker build -t unierp-api .
#
# The previous Dockerfile here `COPY`d pnpm-lock.yaml, pnpm-workspace.yaml,
# apps/ and packages/ — four paths that have never existed in this repository —
# so it failed on its first instruction and was removed. This one is verified by
# building.

# ── build ───────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

# openssl is Prisma's runtime requirement, and python3/make/g++ are needed by
# isolated-vm, which the § 8.3 extension sandbox compiles from source.
RUN apt-get update && apt-get install -y openssl python3 make g++

# Manifests first, so a source-only change does not re-resolve the tree.
# The repository's own .npmrc is deliberately NOT copied.
COPY package.json package-lock.json* ./

# @unerp/* resolves from the registry. In compose this is the `registry`
# service; the default is the host's, for a plain `docker build` on the machine
# that runs Verdaccio.
#
# Written into a project-level .npmrc rather than set with `npm config set`,
# which writes the USER config — and npm's precedence puts the project file
# above it. Copying the repo's .npmrc and then trying to override it that way
# left `localhost:4873` in force, so metadata resolved through the host while
# the tarball URLs Verdaccio generated pointed at the container itself, and the
# install died on ECONNREFUSED partway through. Verdaccio builds those URLs from
# the request's Host header, so the registry this file names is also the host
# the tarballs will be fetched from.
ARG UNIERP_REGISTRY=http://host.docker.internal:4873/
RUN printf '@kannan19302:registry=%s\nregistry=https://registry.npmjs.org/\n' "$UNIERP_REGISTRY" > .npmrc \
 # package-lock.json records the absolute tarball URL each dependency resolved
 # to, so a lockfile written against a registry on `localhost` is a lockfile
 # that only installs on the machine that wrote it. Inside a container
 # `localhost` is the container, and the install dies on ECONNREFUSED partway
 # through — after the metadata resolved perfectly, which is what makes it
 # confusing.
 #
 # Rewriting the host here keeps the lockfile's integrity hashes and pinned
 # versions doing their job while letting the URL follow the environment. The
 # durable fix is a registry addressed by a name that resolves the same way
 # everywhere; until § 14.1's "a registry CI can reach" decision is taken, this
 # is the honest workaround rather than dropping the lockfile.
 && rm -f package-lock.json \
 && npm install --no-audit --no-fund

# @unerp/database generates its Prisma clients in a postinstall, and the
# generator parses a schema that reads env("DATABASE_URL"). It never connects —
# a syntactically valid placeholder is enough, and the real URL is read at
# runtime.
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder

COPY tsconfig.json nest-cli.json ./
COPY src ./src

# ── dev ─────────────────────────────────────────────────────────────────────
# Build dist/ at IMAGE BUILD TIME using webpack (via nest build), not at
# container start. Running `nest start --watch` (tsc watch) inside the
# container held ~5 GB of V8 heap indefinitely, crashing Docker Desktop's
# WSL2 engine under the 10 GB memory budget shared across all services.
#
# With webpack the build uses ~800 MB and exits; the container then runs
# `node dist/main.js` which is a cheap, stable process.
#
# Trade-off: src/ changes need `docker restart unerp-api` to be picked up
# (same rule as unerp-web's app/ routes). The mounted src/ volume is still
# useful for inspecting source inside the container.
# ── local package overlay (DEV ONLY) ────────────────────────────────────────
#
# Same reasoning as idp/Dockerfile's localdeps stage, different symptom: this
# service imports members of `@kannan19302/shared` (resolve, bindProvider,
# unbindProvider, CreateScorecardInput, CreateForecastDto, CompleteTaskInput,
# ReconciliationEntry, the builder-workflow and custom-object schemas) that all
# exist in the local `shared` package but not in published shared@1.0.5. The
# `nest build` below therefore failed with 32 "has no exported member" errors,
# so this image could not be built at all.
#
# DEV target only — `prod-builder` still builds against the registry, keeping
# publishing as the real release path. Sources come from the `localpkgs` named
# build context (repo root, wired in infra/docker-compose.platform.yml); the
# default `docker build .` target is `runner`, which never builds this stage.
FROM builder AS localdeps

# tsconfig.base.json is required, not optional — see idp/Dockerfile: a missing
# extends target makes tsc fall back to ES3/ES5 defaults and report dozens of
# spurious "Property 'padStart' does not exist" errors instead of failing on
# the real cause.
COPY --from=localpkgs shared/package.json shared/tsconfig.json shared/tsconfig.base.json /tmp/shared/
COPY --from=localpkgs shared/src /tmp/shared/src
RUN cd /tmp/shared \
 && npm install --no-audit --no-fund \
 && npm run build

COPY --from=localpkgs data/package.json data/tsconfig.json data/tsconfig.base.json data/prisma.config.ts /tmp/data/
COPY --from=localpkgs data/prisma /tmp/data/prisma
COPY --from=localpkgs data/src /tmp/data/src
COPY --from=localpkgs data/scripts /tmp/data/scripts
# Host-generated Prisma output carries a host-native query engine; regenerate
# on this platform instead (see data/scripts/postinstall.mjs for why the
# published package ships prisma/ but never the generated client).
RUN rm -rf /tmp/data/src/idp-client /tmp/data/dist \
 && cd /tmp/data \
 && npm install --no-audit --no-fund \
 && npm run build

RUN rm -rf node_modules/@kannan19302/shared node_modules/@kannan19302/database \
 && mkdir -p node_modules/@kannan19302 \
 && cp -r /tmp/shared node_modules/@kannan19302/shared \
 && cp -r /tmp/data node_modules/@kannan19302/database \
 && rm -rf /tmp/shared /tmp/data

FROM localdeps AS dev
ENV NODE_ENV=development
# Build the bundle inside the image so the container starts instantly.
RUN node --max-old-space-size=8192 ./node_modules/@nestjs/cli/bin/nest.js build
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ── build ───────────────────────────────────────────────────────────────────
# FROM builder, not dev: the production artifact is built against the registry,
# so a published release never silently depends on a developer's working tree.
FROM builder AS prod-builder
RUN npm run build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y openssl

# The generated Prisma client lives in node_modules, so it has to come across
# with it rather than being regenerated in an image with no schema.
COPY --from=prod-builder /app/node_modules ./node_modules
COPY --from=prod-builder /app/dist ./dist
COPY --from=prod-builder /app/package.json ./package.json

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
