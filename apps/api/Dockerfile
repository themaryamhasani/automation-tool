FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/runner/package.json apps/runner/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev
COPY apps/api apps/api
COPY shared shared
COPY database database
COPY scripts/db-setup.cjs scripts/db-setup.cjs
COPY scripts/db-seed.cjs scripts/db-seed.cjs
ENV NODE_ENV=production
EXPOSE 4280
CMD ["sh", "-c", "node scripts/db-setup.cjs && node scripts/db-seed.cjs && node apps/api/src/main.cjs"]
