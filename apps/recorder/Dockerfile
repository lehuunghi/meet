FROM node:24-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app/recorder
COPY recorder/package*.json ./
RUN npm ci && npx playwright install --with-deps chromium && apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core && rm -rf /var/lib/apt/lists/*
COPY recorder/ ./
COPY web/src/drawing-model.ts web/src/media.ts web/src/ui-language.ts web/src/api.ts web/src/form-guard-core.ts web/src/devices.ts /app/web/src/
RUN npm run build && chmod 755 /app /app/recorder /app/recorder/dist && chmod 644 package.json worker.mjs core.mjs dist/browser.js && mkdir -p /var/lib/meet-recorder && chown 10001:10001 /var/lib/meet-recorder
USER 10001:10001
CMD ["node", "worker.mjs"]
