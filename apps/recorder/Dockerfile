FROM node:24-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app/recorder
COPY recorder/package*.json ./
RUN npm ci && npx playwright install --with-deps chromium && apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core && rm -rf /var/lib/apt/lists/*
COPY recorder/ ./
COPY web/src/media.ts web/src/api.ts web/src/devices.ts /app/web/src/
RUN npm run build && mkdir -p /var/lib/meet-recorder && chown 10001:10001 /var/lib/meet-recorder
USER 10001:10001
CMD ["node", "worker.mjs"]
