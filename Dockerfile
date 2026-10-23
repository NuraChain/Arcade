# The server listens on 127.0.0.1 only (main.ts), so a published port reaches nothing: run the
# container on the host's network and point the host's nginx at 127.0.0.1:4900 as README.md says.
#
#   docker build -t baziche .
#   docker run --rm --network host baziche node .dist-backend/db/sync-cli.js
#   docker run -d --name baziche --restart unless-stopped --network host \
#       -v baziche-logs:/app/.logs baziche
#
# The root .env goes into the image, so build it only where the image stays: the client build
# reads PUBLIC_ORIGIN from it for the link preview, and the server reads it at /app/.env, beside
# .dist-backend, at every start. A variable the container is given wins over the file.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY . .
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
COPY --from=build /app/.env* ./
RUN mkdir .logs && chown node:node .logs
USER node
CMD ["node", "--enable-source-maps", ".dist-backend/main.js"]
