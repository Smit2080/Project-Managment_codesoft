FROM node:20-alpine AS builder-server
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx prisma generate
RUN npm run build 2>/dev/null || true

FROM node:20-alpine AS builder-client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache postgresql-client
WORKDIR /app
COPY --from=builder-server /app/server/node_modules ./node_modules
COPY --from=builder-server /app/server ./
COPY --from=builder-client /app/client/dist ./client-dist
RUN mkdir -p uploads

ENV NODE_ENV=production
ENV PORT=5000
ENV UPLOAD_DIR=./uploads

EXPOSE 5000

CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
