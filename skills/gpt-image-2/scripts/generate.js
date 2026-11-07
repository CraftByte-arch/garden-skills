import process from "node:process";
import {
  DEFAULT_IMAGE_DIR,
  DEFAULT_GENERATION_MODEL,
  SUPPORTED_COMPLEXITY_LEVELS,
  SUPPORTED_IMAGE_MODELS,
  SUPPORTED_OUTPUT_FORMATS,
  SUPPORTED_QUALITY_LEVELS,
  buildBaseUrl,
  buildDefaultImagePath,
  extractGeneratedImages,
  extensionForFormat,
  ensureFilesExist,
  loadAmbientEnv,
  printJson,
  readPromptInput,
  resolveImageModel,
  resolveOutputFormat,
  resolveOutputPaths,
  saveImage,
  savePrompt,
  validateImageOutputOptions,
  validateModelSpecificOptions,
  postJson,
  slugify,
} from "./shared.js";

function printHelp() {
  console.log(`Usage:
  node scripts/generate.js --prompt "A cute baby sea otter" --image out/otter.png

Options:
  --prompt <text>              Prompt text
  --promptfile <path>          Load prompt from a file
  --prompt-output <path>       Save the final prompt to a specific file
  --image <path>               Output image path (default: ${DEFAULT_IMAGE_DIR}/<slug>-<timestamp>.png)
  --model <name>               Model override (default: ${DEFAULT_GENERATION_MODEL}; known: ${SUPPORTED_IMAGE_MODELS.join(" | ")})
  --size <WxH>                 Output size
  --n <count>                  Number of images (1-10)
  --quality <level>            ${SUPPORTED_QUALITY_LEVELS.join(" | ")}
  --complexity <level>         ${SUPPORTED_COMPLEXITY_LEVELS.join(" | ")} (GPT Image 2.6)
  --background <mode>          transparent | opaque | auto
  --moderation <level>         low | auto
  --output-format <format>     ${SUPPORTED_OUTPUT_FORMATS.join(" | ")} (gif/svg require GPT Image 2.6)
  --output-compression <0-100> Compression for jpeg/webp
  --frame-count <2-16>         GIF frame count
  --frame-duration-ms <ms>     GIF frame duration (20-2000; API rounds to 10 ms)
  --json                       Print structured output
  -h, --help                   Show help`);
}

function parseCli(argv) {
  const cfg = {
    prompt: null,
    promptFile: null,
    promptOutput: null,
    imagePath: null,
    model: null,
    size: null,
    n: null,
    quality: null,
    complexity: null,
    background: null,
    moderation: null,
    outputFormat: null,
    outputCompression: null,
    frameCount: null,
    frameDurationMs: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      cfg.help = true;
      continue;
    }
    if (arg === "--json") {
      cfg.json = true;
      continue;
    }
    if (arg === "--prompt") {
      cfg.prompt = argv[++i] || null;
      if (!cfg.prompt) throw new Error("Missing value for --prompt");
      continue;
    }
    if (arg === "--promptfile") {
      cfg.promptFile = argv[++i] || null;
      if (!cfg.promptFile) throw new Error("Missing value for --promptfile");
      continue;
    }
    if (arg === "--prompt-output") {
      cfg.promptOutput = argv[++i] || null;
      if (!cfg.promptOutput) throw new Error("Missing value for --prompt-output");
      continue;
    }
    if (arg === "--image") {
      cfg.imagePath = argv[++i] || null;
      if (!cfg.imagePath) throw new Error("Missing value for --image");
      continue;
    }
    if (arg === "--model") {
      cfg.model = argv[++i] || null;
      if (!cfg.model) throw new Error("Missing value for --model");
      continue;
    }
    if (arg === "--size") {
      cfg.size = argv[++i] || null;
      if (!cfg.size) throw new Error("Missing value for --size");
      continue;
    }
    if (arg === "--n") {
      cfg.n = argv[++i] || null;
      if (!cfg.n) throw new Error("Missing value for --n");
      continue;
    }
    if (arg === "--quality") {
      cfg.quality = argv[++i] || null;
      if (!cfg.quality) throw new Error("Missing value for --quality");
      continue;
    }
    if (arg === "--complexity") {
      cfg.complexity = argv[++i] || null;
      if (!cfg.complexity) throw new Error("Missing value for --complexity");
      continue;
    }
    if (arg === "--background") {
      cfg.background = argv[++i] || null;
      if (!cfg.background) throw new Error("Missing value for --background");
      continue;
    }
    if (arg === "--moderation") {
      cfg.moderation = argv[++i] || null;
      if (!cfg.moderation) throw new Error("Missing value for --moderation");
      continue;
    }
    if (arg === "--output-format") {
      cfg.outputFormat = argv[++i] || null;
      if (!cfg.outputFormat) throw new Error("Missing value for --output-format");
      continue;
    }
    if (arg === "--output-compression") {
      cfg.outputCompression = argv[++i] || null;
      if (!cfg.outputCompression) throw new Error("Missing value for --output-compression");
      continue;
    }
    if (arg === "--frame-count") {
      cfg.frameCount = argv[++i] || null;
      if (!cfg.frameCount) throw new Error("Missing value for --frame-count");
      continue;
    }
    if (arg === "--frame-duration-ms") {
      cfg.frameDurationMs = argv[++i] || null;
      if (!cfg.frameDurationMs) throw new Error("Missing value for --frame-duration-ms");
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return cfg;
}

function buildPayload(cfg, prompt) {
  const payload = {
    prompt,
    model: resolveImageModel("generate", cfg.model),
  };
  if (cfg.size) payload.size = cfg.size;
  if (cfg.n) payload.n = Number(cfg.n);
  if (cfg.quality) payload.quality = cfg.quality;
  if (cfg.complexity) payload.complexity = cfg.complexity;
  if (cfg.background) payload.background = cfg.background;
  if (cfg.moderation) payload.moderation = cfg.moderation;
  if (cfg.outputFormat) payload.output_format = cfg.outputFormat;
  if (cfg.outputCompression) payload.output_compression = Number(cfg.outputCompression);
  if (cfg.frameCount) payload.frame_count = Number(cfg.frameCount);
  if (cfg.frameDurationMs) payload.frame_duration_ms = Number(cfg.frameDurationMs);
  return payload;
}

function buildRequestUrl() {
  return `${buildBaseUrl()}/images/generations`;
}

async function run() {
  const cfg = parseCli(process.argv.slice(2));
  if (cfg.help) {
    printHelp();
    return;
  }

  await loadAmbientEnv();
  const prompt = await readPromptInput(cfg.prompt, cfg.promptFile);
  const nameHint = slugify(prompt.split(/\s+/).slice(0, 8).join(" "), "generated-image");
  const formatSelection = resolveOutputFormat(cfg.outputFormat, cfg.imagePath);
  const outputFormat = formatSelection.format;
  cfg.outputFormat = formatSelection.shouldSend ? outputFormat : null;
  const count = cfg.n === null ? 1 : Number(cfg.n);
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("--n must be an integer from 1 to 10.");
  if (cfg.quality && !SUPPORTED_QUALITY_LEVELS.includes(cfg.quality)) {
    throw new Error(`Unsupported --quality value: ${cfg.quality}`);
  }
  if (cfg.complexity && !SUPPORTED_COMPLEXITY_LEVELS.includes(cfg.complexity)) {
    throw new Error(`Unsupported --complexity value: ${cfg.complexity}`);
  }
  const model = resolveImageModel("generate", cfg.model);
  validateModelSpecificOptions({ model, format: outputFormat, complexity: cfg.complexity });
  validateImageOutputOptions({
    format: outputFormat,
    n: count,
    compression: cfg.outputCompression,
    frameCount: cfg.frameCount,
    frameDurationMs: cfg.frameDurationMs,
  });
  const promptPath = await savePrompt(prompt, cfg.promptOutput, nameHint);
  const fallbackPath = buildDefaultImagePath("generate", nameHint, extensionForFormat(outputFormat));
  await ensureFilesExist([], "input");

  const payload = buildPayload(cfg, prompt);
  const url = buildRequestUrl();
  const json = await postJson(url, payload);
  const images = await extractGeneratedImages(json);
  const outputPaths = resolveOutputPaths(cfg.imagePath, fallbackPath, outputFormat, images.length);
  await Promise.all(images.map((bytes, index) => saveImage(outputPaths[index], bytes)));

  if (cfg.json) {
    printJson({
      savedImage: outputPaths[0],
      savedImages: outputPaths,
      outputFormat,
      savedPrompt: promptPath,
      model: payload.model,
      requestUrl: url,
      apiResponse: json,
    });
    return;
  }

  console.log(outputPaths.join("\n"));
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
