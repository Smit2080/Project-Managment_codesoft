FROM node:20-alpine AS builder-client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache postgresql-client
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx prisma generate
COPY --from=builder-client /app/client/dist /app/client/dist
RUN mkdir -p uploads logs

ENV NODE_ENV=production
ENV PORT=5000
ENV UPLOAD_DIR=./uploads
ENV AUDIT_LOG_PATH=./logs/audit.log

EXPOSE 5000

CMD ["sh", "-c", "npx prisma migrate deploy && node prisma/seed.js; node src/index.js"]
