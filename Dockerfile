FROM oven/bun:1

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV FFMPEG_PATH=/usr/bin/ffmpeg

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .

RUN bunx prisma generate
RUN bun run build

EXPOSE 4000

CMD ["sh", "-c", "bunx prisma migrate deploy && bun run start:prod"]
