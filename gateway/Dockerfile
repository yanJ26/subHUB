FROM node:24-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN mkdir -p /data && chown -R node:node /app /data
USER node
ENV NODE_ENV=production
ENV SUBHUB_GATEWAY_HOST=0.0.0.0
ENV SUBHUB_GATEWAY_PORT=8790
ENV SUBHUB_DB_PATH=/data/subhub.sqlite
EXPOSE 8790
CMD ["node", "src/server.mjs"]
