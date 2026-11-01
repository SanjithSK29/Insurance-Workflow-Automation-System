# IWAS container image (SAD 3.6: Docker / Kubernetes deployment)
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    IWAS_DB=/data/iwas.db
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/api/v1/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
