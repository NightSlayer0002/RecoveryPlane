FROM node:22-bookworm-slim
WORKDIR /app
RUN npm install -g pnpm@9.1.0
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["node", "--import", "tsx", "apps/api/src/main.ts"]
