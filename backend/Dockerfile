# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
# Prisma needs OpenSSL on Alpine (musl) to run its query/schema engines.
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# openssl: Prisma engines (musl). postgresql16-client: pg_dump for the nightly
# backup job (Phase 1D) — matches the postgres:16-alpine server image exactly.
RUN apk add --no-cache openssl postgresql16-client
COPY package*.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
# entrypoint: run migrations + seed, then start
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
