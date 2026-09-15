FROM node:24-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /data && chown -R node:node /app /data
USER node
ENV NODE_ENV=production
ENV SUBHUB_GATEWAY_HOST=0.0.0.0
ENV SUBHUB_GATEWAY_PORT=8790
ENV SUBHUB_DB_PATH=/data/subhub.sqlite
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8790/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "src/server.mjs"]
