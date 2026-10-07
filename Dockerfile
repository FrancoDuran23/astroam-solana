# API image for Fly (or any container host). No secrets are baked in.
# Set SOLANA_* and the keypair JSON at runtime. See docs/deploy.md.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "run", "server"]
