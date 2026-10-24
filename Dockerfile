# A container's 127.0.0.1 is its own, so the image binds 0.0.0.0 (HOST). An env the container is
# given wins over the image's, so write HOST=0.0.0.0 there too (in Dokploy's environment, or in the
# .env passed with --env-file). Publish the port to the proxy alone: the server trusts
# X-Forwarded-For in production, so a port the internet reaches lets a caller pick their address.
#
#   docker build --build-arg PUBLIC_ORIGIN=https://play.example.com -t baziche .
#   docker run --rm --env-file .env baziche node .dist-backend/db/sync-cli.js
#   docker run -d --name baziche --restart unless-stopped --env-file .env -p 127.0.0.1:4900:4900 #       -v baziche-logs:/app/.logs baziche
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
ENV HOST=0.0.0.0
RUN mkdir .logs && chown node:node .logs
USER node
CMD ["node", "--enable-source-maps", ".dist-backend/main.js"]
