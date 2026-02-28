FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Run
EXPOSE 4002
ENV PORT=4002

CMD ["bun", "run", "src/index.ts"]
