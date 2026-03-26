FROM oven/bun:1

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV WHISPER_PYTHON_BIN=python3
ENV WHISPER_SCRIPT_PATH=/app/scripts/transcribe.py

RUN python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir faster-whisper

RUN python3 -c "import faster_whisper; print('faster-whisper ok')"

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .

RUN bunx prisma generate
RUN bun run build

EXPOSE 4000

CMD ["sh", "-c", "bunx prisma migrate deploy && bun run start:prod"]
