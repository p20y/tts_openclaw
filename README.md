# Open Claw Kokoro TTS Plugin

Local text-to-speech plugin built on Kokoro, designed for Open Claw plugin execution without FastAPI.

## What this provides

- `openclaw_kokoro_plugin` package with an in-process plugin class.
- CLI adapter for plugin runtimes that execute shell commands.
- Automatic device selection: `mps` (Apple Silicon/M4) -> `cuda` -> `cpu`.
- Safe fallback to CPU if GPU init fails.
- Backward-compatible `openclo_*` module/script aliases.

## Install

```bash
.venv/bin/pip install -e .
```

## CLI usage

```bash
openclaw-kokoro-tts \
  --text "Hello from Kokoro" \
  --voice af_heart \
  --lang a \
  --speed 1.0 \
  --device auto \
  --format wav \
  --output ./sample.wav
```

The command prints JSON:

- `ok=true` with `device_used`, `used_fallback`, `output_path`, etc.
- `ok=false` with an error string.

For inline payloads:

```bash
openclaw-kokoro-tts --text "Hello" --format wav_base64
```

## Open Claw plugin registration

Use `/Users/pradeepsrini/projects/tts/openclaw_plugin.json` as the starter manifest.

Entrypoint:

- `python -m openclaw_kokoro_plugin.cli`

## In-process usage

```python
from openclaw_kokoro_plugin import OpenClawKokoroTTSPlugin

plugin = OpenClawKokoroTTSPlugin(preferred_device="auto")
result = plugin.synthesize(
    text="This is a local Kokoro voice.",
    voice="af_heart",
    lang_code="a",
    speed=1.0,
    output_path="./voice.wav",
    response_format="wav",
)
print(result)
```
