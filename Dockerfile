FROM node:24-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app ./
EXPOSE 3000
CMD ["node", "node_modules/vinext/dist/cli.js", "start"]
