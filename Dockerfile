FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY server ./server
COPY tools ./tools
COPY public ./public
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    BOT_CROSSING_HOST=0.0.0.0 \
    BOT_CROSSING_DATA=/app/data \
    PORT=5274
WORKDIR /app

# Frontend dependencies are bundled in dist. The server needs its own few at run time:
# the Postgres client for the crew backend, and git to seed a workspace from a repository.
# The ssh client is named because git only recommends it, and ssh:// sources need it.
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir -p /app/data /var/lib/worlds && chown node:node /app/data /var/lib/worlds
USER node

EXPOSE 5274
CMD ["node", "server/serve.mjs"]
