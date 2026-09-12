# El front se compila aparte; el backend solo sirve el resultado.
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DB_PATH=/data/mercadia.db WEB_DIR=/app/public
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY --from=web /web/dist/web/browser ./public

# El volumen hereda dueño y permisos de esta carpeta cuando Docker lo crea,
# así que el mercado no corre como root.
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/main.js"]
