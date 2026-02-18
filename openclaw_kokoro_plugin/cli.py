from __future__ import annotations

import argparse
import json
from pathlib import Path

from .plugin import KokoroPluginError, OpenClawKokoroTTSPlugin


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Open Claw Kokoro TTS plugin CLI")
    parser.add_argument("--text", required=True, help="Text to synthesize")
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--lang", default="a", help="Kokoro language code (a/b)")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument(
        "--device",
        default="auto",
        choices=["auto", "mps", "cuda", "cpu"],
        help="Preferred compute device",
    )
    parser.add_argument(
        "--format",
        dest="response_format",
        default="wav",
        choices=["wav", "wav_base64"],
        help="Plugin response format",
    )
    parser.add_argument(
        "--output",
        default="./output.wav",
        help="Output WAV path (required for --format wav)",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    plugin = OpenClawKokoroTTSPlugin(default_lang_code=args.lang, preferred_device=args.device)

    output_path = str(Path(args.output).expanduser()) if args.response_format == "wav" else None

    try:
        result = plugin.synthesize(
            text=args.text,
            voice=args.voice,
            speed=args.speed,
            lang_code=args.lang,
            preferred_device=args.device,
            output_path=output_path,
            response_format=args.response_format,
        )
    except KokoroPluginError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), flush=True)
        return 1

    print(json.dumps({"ok": True, "result": result}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
