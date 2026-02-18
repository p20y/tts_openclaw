import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  if (!parsed.ok) {
    throw new Error(parsed.error || "Unknown Kokoro plugin error");
  }

  return parsed.result;
}

const VOICES = {
  a: [
    "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole",
    "af_nova", "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir",
    "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa"
  ],
  b: ["bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis"],
};

function toolSchema() {
  return {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to synthesize" },
      voice: { type: "string", default: "af_heart" },
      lang: { type: "string", default: "a", enum: ["a", "b"] },
      speed: { type: "number", default: 1.0 },
      device: { type: "string", default: "auto", enum: ["auto", "mps", "cuda", "cpu"] },
      format: { type: "string", default: "ogg_base64", enum: ["wav", "wav_base64", "ogg", "ogg_base64"] },
    },
    required: ["text"],
  };
}

function mimeFromFormat(responseFormat) {
  if ((responseFormat || "").startsWith("ogg")) return "audio/ogg";
  return "audio/wav";
}

function normalizeKokoroResponse(result, audioBase64) {
  const mimeType = mimeFromFormat(result.response_format);
  const meta = {
    provider: "kokoro",
    device_used: result.device_used,
    used_fallback: result.used_fallback,
    sample_rate: result.sample_rate,
    lang_code: result.lang_code,
    voice: result.voice,
    speed: result.speed,
    response_format: result.response_format,
    output_path: result.output_path,
    audio_base64: audioBase64,
    mime_type: mimeType,
  };

  // Return both top-level fields and OpenAI-style content blocks for compatibility.
  return {
    ...meta,
    content: [
      { type: "text", text: JSON.stringify(meta, null, 2) },
      ...(audioBase64 ? [{ type: "audio", mimeType, data: audioBase64 }] : []),
    ],
  };
}

function buildKokoroHandler(api) {
  const pluginRoot = __dirname;
  const configuredPython =
    typeof api.getConfig === "function" ? api.getConfig("pythonPath") : undefined;

  return async (args = {}) => {
    const text = `${args.text || ""}`.trim();
    if (!text) throw new Error("'text' is required");

    const responseFormat = args.format || "ogg_base64";
    const ext = responseFormat.startsWith("ogg") ? "ogg" : "wav";
    const outputPath = path.join(
      os.tmpdir(),
      `kokoro-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    );

    const cliArgs = [
      "--text", text,
      "--voice", args.voice || "af_heart",
      "--lang", args.lang || "a",
      "--speed", `${Number(args.speed ?? 1.0)}`,
      "--device", args.device || "auto",
      "--format", responseFormat,
    ];

    if (responseFormat === "wav" || responseFormat === "ogg") cliArgs.push("--output", outputPath);

    const result = runKokoro(cliArgs, pluginRoot, configuredPython);
    let audioBase64 = result.audio_base64;
    if (!audioBase64 && result.output_path && fs.existsSync(result.output_path)) {
      audioBase64 = fs.readFileSync(result.output_path).toString("base64");
    }

    return normalizeKokoroResponse(result, audioBase64);
  };
}

function registerTools(api) {
  const kokoroHandler = buildKokoroHandler(api);
  const schema = toolSchema();

  // Support object-style registerTool({ name, description, parameters, handler }).
  if (typeof api.registerTool === "function" && api.registerTool.length <= 1) {
    api.registerTool({
      name: "kokoro_tts",
      description: "Generate speech with local Kokoro (M4/MPS preferred, CPU fallback).",
      parameters: schema,
      handler: kokoroHandler,
    });
    api.registerTool({
      name: "kokoro_voices",
      description: "List supported Kokoro voices by language.",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ voices: VOICES, content: [{ type: "text", text: JSON.stringify(VOICES, null, 2) }] }),
    });
  } else if (typeof api.registerTool === "function") {
    // Support positional registerTool(name, description, schema, handler).
    api.registerTool(
      "kokoro_tts",
      "Generate speech with local Kokoro (M4/MPS preferred, CPU fallback).",
      schema,
      kokoroHandler
    );
    api.registerTool(
      "kokoro_voices",
      "List supported Kokoro voices by language.",
      { type: "object", properties: {} },
      async () => ({ voices: VOICES, content: [{ type: "text", text: JSON.stringify(VOICES, null, 2) }] })
    );
  } else {
    throw new Error("OpenClaw API missing registerTool");
  }
}

export function register(api) {
  registerTools(api);
  if (typeof api.log === "function") api.log("Kokoro Local TTS plugin registered");
}

export async function activate(api) {
  if (typeof api.log === "function") api.log("Kokoro Local TTS plugin activated");
}

export async function deactivate(api) {
  if (typeof api.log === "function") api.log("Kokoro Local TTS plugin deactivated");
}

export default {
  id: "kokoro-local-tts-plugin",
  name: "Kokoro Local TTS Plugin",
  version: "1.0.2",
  register,
  activate,
  deactivate,
};
