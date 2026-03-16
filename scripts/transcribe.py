import sys
import json
from faster_whisper import WhisperModel

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "audio file path required"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "small"
    device = sys.argv[3] if len(sys.argv) > 3 else "cpu"
    compute_type = sys.argv[4] if len(sys.argv) > 4 else "int8"

    try:
        model = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
        )

        segments_generator, info = model.transcribe(
            audio_path,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500
            ),
        )

        segments = []
        texts = []

        for segment in segments_generator:
            text = (segment.text or "").strip()
            if text:
                texts.append(text)

            segments.append({
                "id": len(segments),
                "start": float(segment.start),
                "end": float(segment.end),
                "text": text,
            })

        print(json.dumps({
            "text": " ".join(texts).strip(),
            "language": getattr(info, "language", None),
            "duration": getattr(info, "duration", None),
            "segments": segments,
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()