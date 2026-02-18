# Open Claw Kokoro TTS Plugin

This repository provides a direct OpenClaw plugin (`openclaw.plugin.json` + `index.js`) that generates local TTS audio using Kokoro.

## Features

- No ElevenLabs dependency.
- GPU-first device selection: `mps` (Apple M4/Apple Silicon), then `cuda`, then `cpu`.
- Automatic CPU fallback if GPU init is unavailable/fails.
- OpenClaw tools:
  - `kokoro_tts`
  - `kokoro_voices`

## Repository layout

- `openclaw.plugin.json`: OpenClaw plugin manifest.
- `index.js`: OpenClaw Node extension entrypoint (registers tools).
- `openclaw_kokoro_plugin/`: Python Kokoro synthesis engine.
- `pyproject.toml`: Python packaging and CLI script definitions.

## Local setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

## Test engine directly

```bash
python -m openclaw_kokoro_plugin.cli \
  --text "Hello from Kokoro" \
  --voice af_heart \
  --lang a \
  --speed 1.0 \
  --device auto \
  --format wav \
  --output ./sample.wav
```

## OpenClaw integration

1. Point OpenClaw to this plugin folder (contains `openclaw.plugin.json`).
1. Ensure Python is available to OpenClaw runtime.
1. If needed, set `OPENCLAW_PYTHON` env var to the desired interpreter path.

### Tool: `kokoro_tts`

Input schema:

- `text` (required)
- `voice` (default: `af_heart`)
- `lang` (`a` or `b`)
- `speed` (default: `1.0`)
- `device` (`auto|mps|cuda|cpu`, default: `auto`)
- `format` (`wav|wav_base64`, default: `wav`)

Returns JSON text containing device info and either `output_path` (wav) or `audio_base64`.
