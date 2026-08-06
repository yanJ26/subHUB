FROM node:24-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN mkdir -p /data && chown -R node:node /app /data
USER node
ENV NODE_ENV=production
ENV APIHUB_GATEWAY_HOST=0.0.0.0
ENV APIHUB_GATEWAY_PORT=8787
ENV APIHUB_DB_PATH=/data/apihub.sqlite
EXPOSE 8787
CMD ["node", "src/server.mjs"]
