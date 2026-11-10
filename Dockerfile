# AquaCloud builds and runs the application from this Dockerfile.
# Keep database operations at runtime, where the app's runtime variables are available.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Prisma config requires DATABASE_URL during validation/generation.
# This local placeholder is build-only; AquaCloud supplies the runtime database URL.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" npm run build

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["npm", "start"]
