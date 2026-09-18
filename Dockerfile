# Consent-check als container, voor als de tool ergens moet draaien waar
# collega's hem via een link kunnen gebruiken (Render, Fly.io, een eigen VPS).
#
# De basis is de officiële Playwright-image: die bevat Chromium én de
# systeembibliotheken die een browser op Linux nodig heeft. Het versienummer
# moet gelijk lopen met de playwright-versie in package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production
# In een container luistert de server op alle adressen; het platform zet er
# zelf een afgeschermde laag voor. Lokaal blijft de standaard 127.0.0.1.
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NO_OPEN=1

WORKDIR /app

# Eerst alleen de manifesten: zolang die niet wijzigen, hergebruikt Docker
# de geïnstalleerde dependencies bij een nieuwe build.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "server/server.js"]
