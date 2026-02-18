import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VOICES = {
  a: [
    "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole",
    "af_nova", "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir",
    "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa"
  ],
  b: ["bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis"],
};

function resolvePython(pluginRoot, preferredPython) {
  if (preferredPython && preferredPython.trim()) return preferredPython.trim();
  if (process.env.OPENCLAW_PYTHON && process.env.OPENCLAW_PYTHON.trim()) {
    return process.env.OPENCLAW_PYTHON.trim();
  }

  if (process.env.VIRTUAL_ENV) {
    const active = path.join(process.env.VIRTUAL_ENV, "bin", "python");
    if (fs.existsSync(active)) return active;
  }

  let cursor = pluginRoot;
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(cursor, ".venv", "bin", "python");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  return "python3";
}

function runKokoro(args, pluginRoot, preferredPython) {
  const pythonBin = resolvePython(pluginRoot, preferredPython);
  const env = { ...process.env };
  env.PYTHONPATH = env.PYTHONPATH
    ? `${pluginRoot}${path.delimiter}${env.PYTHONPATH}`
    : pluginRoot;

  const result = spawnSync(pythonBin, ["-m", "openclaw_kokoro_plugin.cli", ...args], {
    cwd: pluginRoot,
    env,
    encoding: "utf8",
    timeout: 120000,
  });

  if (result.error) throw new Error(`Failed to run python plugin: ${result.error.message}`);

  const lines = (result.stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error(`Kokoro CLI produced no output. ${(result.stderr || "").trim()}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(lines[lines.length - 1]);
  } catch {
    throw new Error(`Invalid Kokoro CLI JSON output: ${lines[lines.length - 1]}`);
  }

  if (!parsed.ok) throw new Error(parsed.error || "Unknown Kokoro plugin error");
  return parsed.result;
}

function defaultOutPath(ext) {
  return path.join(os.tmpdir(), `kokoro-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
}

function ensureMediaFile(result, responseFormat) {
  if (result.output_path && fs.existsSync(result.output_path)) {
    return result.output_path;
  }

  if (!result.audio_base64) {
    throw new Error("Kokoro returned no output_path or audio_base64");
  }

  const ext = responseFormat.startsWith("ogg") ? "ogg" : "wav";
  const outPath = defaultOutPath(ext);
  fs.writeFileSync(outPath, Buffer.from(result.audio_base64, "base64"));
  return outPath;
}

function kokoroRunFactory(ctx) {
  const preferredPython =
    typeof ctx?.getConfig === "function" ? ctx.getConfig("pythonPath") : undefined;

  return async function run(input = {}) {
    const text = `${input.text || ""}`.trim();
    if (!text) {
      return { content: [{ type: "text", text: "Error: 'text' is required" }] };
    }

    const responseFormat = input.format || "ogg";
    const ext = responseFormat.startsWith("ogg") ? "ogg" : "wav";
    const outputPath = input.output_path || defaultOutPath(ext);

    const cliArgs = [
      "--text", text,
      "--voice", input.voice || "af_heart",
      "--lang", input.lang || "a",
      "--speed", `${Number(input.speed ?? 1.0)}`,
      "--device", input.device || "auto",
      "--format", responseFormat,
    ];

    if (responseFormat === "wav" || responseFormat === "ogg") {
      cliArgs.push("--output", outputPath);
    }

    const result = runKokoro(cliArgs, __dirname, preferredPython);
    const mediaPath = ensureMediaFile(result, responseFormat);

    return {
      content: [
        { type: "text", text: `MEDIA: ${mediaPath}` },
        {
          type: "text",
          text: JSON.stringify(
            {
              device_used: result.device_used,
              used_fallback: result.used_fallback,
              sample_rate: result.sample_rate,
              response_format: result.response_format,
            },
            null,
            2
          ),
        },
      ],
    };
  };
}

export async function activate(ctx) {
  ctx?.log?.info?.("kokoro plugin activated");

  return {
    tools: {
      kokoro_tts: {
        description: "Generate speech with local Kokoro",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
            voice: { type: "string", default: "af_heart" },
            lang: { type: "string", enum: ["a", "b"], default: "a" },
            speed: { type: "number", default: 1.0 },
            device: { type: "string", enum: ["auto", "mps", "cuda", "cpu"], default: "auto" },
            format: { type: "string", enum: ["wav", "wav_base64", "ogg", "ogg_base64"], default: "ogg" },
            output_path: { type: "string" },
          },
          required: ["text"],
        },
        run: kokoroRunFactory(ctx),
      },
      kokoro_voices: {
        description: "List supported Kokoro voices",
        inputSchema: { type: "object", properties: {} },
        async run() {
          return { content: [{ type: "text", text: JSON.stringify(VOICES, null, 2) }] };
        },
      },
    },
  };
}

export async function deactivate(ctx) {
  ctx?.log?.info?.("kokoro plugin deactivated");
}

export default { activate, deactivate };
