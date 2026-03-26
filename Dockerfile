FROM oven/bun:1

RUN apt-get update && apt-get install -y \
    python3 \
    python3-venv \
    python3-pip \
    ffmpeg \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV WHISPER_PYTHON_BIN=/opt/venv/bin/python
ENV WHISPER_SCRIPT_PATH=/app/scripts/transcribe.py
ENV HF_HOME=/app/.cache/huggingface

RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/python -m pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/python -m pip install --no-cache-dir faster-whisper

RUN /opt/venv/bin/python -c "import faster_whisper; print('faster-whisper ok')"

# Pre-download Whisper model at build time for stable runtime
RUN mkdir -p /app/.cache/huggingface \
    && /opt/venv/bin/python - <<'PY'
from faster_whisper import WhisperModel
WhisperModel("small", device="cpu", compute_type="int8")
print("whisper model cached")
PY

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .

RUN bunx prisma generate
RUN bun run build

EXPOSE 4000

CMD ["sh", "-c", "bunx prisma migrate deploy && bun run start:prod"]
