FROM mcr.microsoft.com/playwright:v1.55.1-noble
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/runner/package.json apps/runner/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev
COPY apps/runner apps/runner
COPY shared shared
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
CMD ["node", "apps/runner/src/main.cjs"]
