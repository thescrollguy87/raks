# Multi-stage build: install deps + generate Prisma client, then run.
FROM node:20-alpine AS base
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm install --omit=dev && npx prisma generate

COPY src ./src

ENV NODE_ENV=production
EXPOSE 4000

# Migrations run explicitly (via `npm run prisma:deploy`, e.g. in a deploy
# step or entrypoint script) rather than automatically on every container
# start — auto-migrating on boot is convenient in dev but risky in
# production with multiple instances starting concurrently.
CMD ["node", "src/server.js"]
