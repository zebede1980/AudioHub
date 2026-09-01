# --- Stage 1: build the frontend static bundle ---
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Stage 2: build the backend (TypeScript -> dist) ---
FROM node:22-alpine AS backend-build
# argon2 and better-sqlite3 need a native toolchain to compile on alpine (musl); no prebuilt binaries.
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# --- Stage 3: production runtime ---
FROM node:22-alpine AS runtime
RUN apk add --no-cache python3 make g++ ffmpeg
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev && apk del python3 make g++
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./public

ENV NODE_ENV=production
EXPOSE 8420
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8420)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
