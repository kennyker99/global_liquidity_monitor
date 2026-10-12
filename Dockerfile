FROM node:20-bookworm-slim AS build

WORKDIR /app

RUN npm install --global pnpm@10.4.1

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

EXPOSE 8080
CMD ["node", "dist/index.js"]
