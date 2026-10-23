# The server listens on 127.0.0.1 only (main.ts), so a published port reaches nothing: run the
# container on the host's network and point the host's nginx at 127.0.0.1:3200 as README.md says.
#
#   docker build --build-arg PUBLIC_ORIGIN=https://play.example.com -t baziche .
#   docker run --rm --network host --env-file .env baziche node .dist-backend/db/sync-cli.js
#   docker run -d --name baziche --restart unless-stopped --network host --env-file .env \
#       -v baziche-logs:/app/.logs baziche
#
# PUBLIC_ORIGIN is read by the client build for the link preview, and again by the server at start.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY . .
ARG PUBLIC_ORIGIN
ENV PUBLIC_ORIGIN=$PUBLIC_ORIGIN
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/.dist-backend .dist-backend
COPY --from=build /app/.dist-frontend .dist-frontend
COPY --from=build /app/.dist-server .dist-server
RUN mkdir .logs && chown node:node .logs
USER node
CMD ["node", "--enable-source-maps", ".dist-backend/main.js"]
