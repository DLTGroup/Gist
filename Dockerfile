# Single container: API + built web app on one origin.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --no-audit --no-fund -w @gist/core -w @gist/api -w @gist/web --include-workspace-root
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 GIST_DB_PATH=/data/gist.db GIST_WEB_DIST=/app/apps/web/dist
COPY --from=build /app /app
VOLUME /data
EXPOSE 8787
WORKDIR /app/apps/api
CMD ["npx", "tsx", "src/server.ts"]
