FROM oven/bun:1

WORKDIR /app

# Force rebuild on source changes - update this timestamp when needed
ENV BUILD_TIMESTAMP=2026-04-22-10:00

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .

RUN bunx prisma generate
RUN bun run build

EXPOSE 4000

CMD ["sh", "-c", "bunx prisma migrate deploy && bun run start:prod"]
