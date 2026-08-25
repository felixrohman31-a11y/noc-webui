# NOC Control Center - (c) 2026 felixrohman31-a11y (MIT) - bebas dipakai
# noc-webui

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY server ./server
RUN mkdir -p data dist
EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0
CMD ["node", "server/index.js"]

