from __future__ import annotations

import base64
import io
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple

import numpy as np
import soundfile as sf
import torch
from kokoro import KPipeline

LANGUAGES: Dict[str, str] = {
    "a": "American English",
    "b": "British English",
}

VOICES: Dict[str, list[str]] = {
    "a": [
        "af_heart",
        "af_alloy",
        "af_aoede",
        "af_bella",
        "af_jessica",
        "af_kore",
        "af_nicole",
        "af_nova",
        "af_river",
        "af_sarah",
        "af_sky",
        "am_adam",
        "am_echo",
        "am_eric",
        "am_fenrir",
        "am_liam",
        "am_michael",
        "am_onyx",
        "am_puck",
        "am_santa",
    ],
    "b": [
        "bf_alice",
        "bf_emma",
        "bf_isabella",
        "bf_lily",
        "bm_daniel",
        "bm_fable",
        "bm_george",
        "bm_lewis",
    ],
}

DEFAULT_REPO_ID = "hexgrad/Kokoro-82M"


class KokoroPluginError(RuntimeError):
    pass


@dataclass(frozen=True)
class DeviceSelection:
    requested: str
    selected: str
    used_fallback: bool


def _auto_device() -> str:
    # Apple Silicon first, then NVIDIA CUDA, then CPU.
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def pick_device(preferred_device: str = "auto") -> DeviceSelection:
    preferred = (preferred_device or "auto").lower().strip()
    if preferred not in {"auto", "mps", "cuda", "cpu"}:
        raise KokoroPluginError(
            f"Invalid preferred_device '{preferred_device}'. Use auto|mps|cuda|cpu."
        )

    if preferred == "auto":
        selected = _auto_device()
        return DeviceSelection(requested="auto", selected=selected, used_fallback=False)

    if preferred == "mps" and not torch.backends.mps.is_available():
        return DeviceSelection(requested="mps", selected="cpu", used_fallback=True)

    if preferred == "cuda" and not torch.cuda.is_available():
        return DeviceSelection(requested="cuda", selected="cpu", used_fallback=True)

    return DeviceSelection(requested=preferred, selected=preferred, used_fallback=False)


class OpenClawKokoroTTSPlugin:
    """
    Open Claw-oriented Kokoro TTS plugin.

    Use `synthesize(...)` in-process, or call the CLI adapter (`python -m openclaw_kokoro_plugin.cli`)
    from any plugin runtime that can execute a command.
    """

    def __init__(self, default_lang_code: str = "a", preferred_device: str = "auto"):
        self.default_lang_code = default_lang_code
        self.preferred_device = preferred_device
        self._pipelines: Dict[Tuple[str, str], KPipeline] = {}

    def metadata(self) -> Dict[str, object]:
        return {
            "name": "kokoro-tts",
            "provider": "kokoro",
            "description": "Local Kokoro text-to-speech plugin with M4/MPS and CPU fallback.",
            "languages": LANGUAGES,
            "voices": VOICES,
            "supports": ["wav", "wav_base64"],
        }

    def _get_pipeline(self, lang_code: str, preferred_device: str) -> tuple[KPipeline, DeviceSelection]:
        if lang_code not in LANGUAGES:
            raise KokoroPluginError(
                f"Unsupported lang_code '{lang_code}'. Supported: {', '.join(LANGUAGES)}"
            )

        selection = pick_device(preferred_device)
        cache_key = (lang_code, selection.selected)
        if cache_key in self._pipelines:
            return self._pipelines[cache_key], selection

        try:
            pipeline = KPipeline(
                lang_code=lang_code,
                repo_id=DEFAULT_REPO_ID,
                device=selection.selected,
            )
            self._pipelines[cache_key] = pipeline
            return pipeline, selection
        except Exception as exc:
            # If GPU init fails unexpectedly, retry on CPU.
            if selection.selected != "cpu":
                pipeline = KPipeline(lang_code=lang_code, repo_id=DEFAULT_REPO_ID, device="cpu")
                self._pipelines[(lang_code, "cpu")] = pipeline
                return pipeline, DeviceSelection(selection.requested, "cpu", True)
            raise KokoroPluginError(f"Failed to initialize Kokoro pipeline: {exc}") from exc

    def synthesize(
        self,
        text: str,
        voice: str = "af_heart",
        speed: float = 1.0,
        lang_code: Optional[str] = None,
        preferred_device: Optional[str] = None,
        output_path: Optional[str] = None,
        response_format: str = "wav",
    ) -> Dict[str, object]:
        if not text or not text.strip():
            raise KokoroPluginError("Text is required.")

        lang = (lang_code or self.default_lang_code).strip()
        device_pref = preferred_device or self.preferred_device

        pipeline, selection = self._get_pipeline(lang_code=lang, preferred_device=device_pref)

        try:
            chunks = [audio for _, _, audio in pipeline(text.strip(), voice=voice, speed=speed)]
        except Exception as exc:
            raise KokoroPluginError(f"Kokoro synthesis failed: {exc}") from exc

        if not chunks:
            raise KokoroPluginError("Kokoro returned no audio chunks.")

        audio_np = np.concatenate(chunks)

        if response_format not in {"wav", "wav_base64"}:
            raise KokoroPluginError("response_format must be one of: wav, wav_base64")

        result: Dict[str, object] = {
            "sample_rate": 24000,
            "device_requested": selection.requested,
            "device_used": selection.selected,
            "used_fallback": selection.used_fallback,
            "lang_code": lang,
            "voice": voice,
            "speed": speed,
            "response_format": response_format,
        }

        if response_format == "wav_base64":
            with io.BytesIO() as buff:
                sf.write(buff, audio_np, 24000, format="WAV")
                result["audio_base64"] = base64.b64encode(buff.getvalue()).decode("ascii")
            return result

        out = Path(output_path).expanduser().resolve() if output_path else None
        if out is None:
            raise KokoroPluginError("output_path is required when response_format='wav'")

        out.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(out), audio_np, 24000)
        result["output_path"] = str(out)
        return result


# Backward compatibility alias for earlier naming.
OpenCloKokoroTTSPlugin = OpenClawKokoroTTSPlugin
