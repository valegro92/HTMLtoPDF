FROM node:20-slim

# Usa Chromium di sistema invece di scaricare Chrome via Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# --ignore-scripts salta il postinstall che scaricherebbe Chrome
RUN npm ci --omit=dev --ignore-scripts

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
