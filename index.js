const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function resolvePython(pluginRoot, preferredPython) {
  if (preferredPython && preferredPython.trim()) {
    return preferredPython.trim();
  }

  if (process.env.OPENCLAW_PYTHON && process.env.OPENCLAW_PYTHON.trim()) {
    return process.env.OPENCLAW_PYTHON.trim();
  }

  if (process.env.VIRTUAL_ENV) {
    const activeVenvPython = path.join(process.env.VIRTUAL_ENV, "bin", "python");
    if (fs.existsSync(activeVenvPython)) {
      return activeVenvPython;
    }
  }

  let cursor = pluginRoot;
  for (let i = 0; i < 4; i += 1) {
    const venvPython = path.join(cursor, ".venv", "bin", "python");
    if (fs.existsSync(venvPython)) {
      return venvPython;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
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

  const result = spawnSync(
    pythonBin,
    ["-m", "openclaw_kokoro_plugin.cli", ...args],
    {
      cwd: pluginRoot,
      env,
      encoding: "utf8",
      timeout: 120000,
    }
  );

  if (result.error) {
    throw new Error(`Failed to run python plugin: ${result.error.message}`);
  }

  const stdout = (result.stdout || "").trim();
  if (!stdout) {
    const stderr = (result.stderr || "").trim();
    throw new Error(`Kokoro CLI produced no output. ${stderr}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout.split("\n").slice(-1)[0]);
  } catch (err) {
    throw new Error(`Invalid Kokoro CLI JSON output: ${stdout}`);
  }

  if (!parsed.ok) {
    throw new Error(parsed.error || "Unknown Kokoro plugin error");
  }

  return parsed.result;
}

module.exports.activate = async function activate(context) {
  const pluginRoot = __dirname;
  const configuredPython =
    typeof context.getConfig === "function" ? context.getConfig("pythonPath") : undefined;
  const voices = {
    a: [
      "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore",
      "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky", "am_adam",
      "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx",
      "am_puck", "am_santa"
    ],
    b: ["bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis"],
  };

  context.log("Kokoro Local TTS plugin activated");

  context.registerTool(
    "kokoro_tts",
    "Generate speech from text with local Kokoro (M4/MPS preferred, CPU fallback).",
    {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to synthesize" },
        voice: { type: "string", default: "af_heart" },
        lang: { type: "string", default: "a", enum: ["a", "b"] },
        speed: { type: "number", default: 1.0 },
        device: { type: "string", default: "auto", enum: ["auto", "mps", "cuda", "cpu"] },
        format: { type: "string", default: "wav", enum: ["wav", "wav_base64"] },
      },
      required: ["text"],
    },
    async (args = {}) => {
      const text = `${args.text || ""}`.trim();
      if (!text) {
        return { content: [{ type: "text", text: "Error: 'text' is required." }] };
      }

      const outputPath = path.join(os.tmpdir(), `kokoro-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
      const responseFormat = args.format || "wav";
      const cliArgs = [
        "--text", text,
        "--voice", args.voice || "af_heart",
        "--lang", args.lang || "a",
        "--speed", `${Number(args.speed ?? 1.0)}`,
        "--device", args.device || "auto",
        "--format", responseFormat,
      ];

      if (responseFormat === "wav") {
        cliArgs.push("--output", outputPath);
      }

      const result = runKokoro(cliArgs, pluginRoot, configuredPython);

      const summary = {
        provider: "kokoro",
        device_used: result.device_used,
        used_fallback: result.used_fallback,
        sample_rate: result.sample_rate,
        lang_code: result.lang_code,
        voice: result.voice,
        speed: result.speed,
        response_format: result.response_format,
      };

      if (result.output_path) {
        summary.output_path = result.output_path;
      }

      if (result.audio_base64) {
        summary.audio_base64 = result.audio_base64;
      }

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  context.registerTool(
    "kokoro_voices",
    "List supported Kokoro voices by language.",
    { type: "object", properties: {} },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(voices, null, 2) }],
    })
  );
};

module.exports.deactivate = async function deactivate(context) {
  context.log("Kokoro Local TTS plugin deactivated");
};
