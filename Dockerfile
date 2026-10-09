FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY apps ./apps
COPY packages ./packages
COPY modules ./modules
COPY scripts ./scripts
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV NODE_ENV=production PORT=3013 RYCOOP_BIND=0.0.0.0
EXPOSE 3013
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3013/api/health',{headers:{host:new URL(process.env.RYCOOP_ORIGIN).host}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","apps/server.js"]
