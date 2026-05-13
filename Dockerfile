FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY config.mjs doubao-protocol.mjs spectra.mjs server.mjs ./
COPY public/ ./public/

EXPOSE 8080

CMD ["node", "server.mjs"]
