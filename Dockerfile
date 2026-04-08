FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .

RUN bunx prisma generate
RUN bun run build

EXPOSE 4000

CMD ["sh", "-c", "bunx prisma migrate deploy && bun run start:prod"]
