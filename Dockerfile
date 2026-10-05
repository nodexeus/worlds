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

# The server uses only Node built-ins; frontend dependencies are bundled in dist.
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 5274
CMD ["node", "server/serve.mjs"]
