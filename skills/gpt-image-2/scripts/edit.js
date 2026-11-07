import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_IMAGE_DIR,
  DEFAULT_EDIT_MODEL,
  SUPPORTED_COMPLEXITY_LEVELS,
  SUPPORTED_IMAGE_MODELS,
  SUPPORTED_OUTPUT_FORMATS,
  SUPPORTED_QUALITY_LEVELS,
  appendIfPresent,
  buildBaseUrl,
  buildDefaultImagePath,
  ensureFilesExist,
  extractGeneratedImages,
  extensionForFormat,
  loadAmbientEnv,
  mimeFor,
  postMultipart,
  printJson,
  readPromptInput,
  resolveImageModel,
  resolveOutputFormat,
  resolveOutputPaths,
  saveImage,
  savePrompt,
  slugify,
  validateImageOutputOptions,
  validateModelSpecificOptions,
} from "./shared.js";

function printHelp() {
  console.log(`Usage:
  node scripts/edit.js --image source.png --prompt "Replace the background with a studio set" --output out/edit.png

Options:
  --image <path>               Source image path (required)
  --mask <path>                Optional mask image path
  --markup <path>              Transparent PNG guidance overlay (2.5/2.6; mutually exclusive with --mask)
  --reference <path>           Additional identity/style reference image (repeatable)
  --prompt <text>              Edit prompt
  --promptfile <path>          Load prompt from a file
  --prompt-output <path>       Save the final prompt to a specific file
  --output <path>              Output image path (default: ${DEFAULT_IMAGE_DIR}/<slug>-<timestamp>.png)
  --model <name>               Model override (default: ${DEFAULT_EDIT_MODEL}; known: ${SUPPORTED_IMAGE_MODELS.join(" | ")})
  --size <WxH|auto>            Output size
  --n <count>                  Number of images (1-10)
  --quality <level>            ${SUPPORTED_QUALITY_LEVELS.join(" | ")}
  --complexity <level>         ${SUPPORTED_COMPLEXITY_LEVELS.join(" | ")} (GPT Image 2.6)
  --background <mode>          transparent | opaque | auto
  --input-fidelity <level>     low | high (not sent to GPT Image 2.6)
  --output-format <format>     ${SUPPORTED_OUTPUT_FORMATS.join(" | ")} (gif requires GPT Image 2.6; svg is generation-only)
  --output-compression <0-100> Compression for jpeg/webp
  --frame-count <2-16>         GIF frame count
  --frame-duration-ms <ms>     GIF frame duration (20-2000; API rounds to 10 ms)
  --moderation <level>         low | auto
  --json                       Print structured output
  -h, --help                   Show help`);
}

function parseCli(argv) {
  const cfg = {
    image: null,
    mask: null,
    markup: null,
    references: [],
    prompt: null,
    promptFile: null,
    promptOutput: null,
    output: null,
    model: null,
    size: null,
    n: null,
    quality: null,
    complexity: null,
    background: null,
    inputFidelity: null,
    outputFormat: null,
    outputCompression: null,
    frameCount: null,
    frameDurationMs: null,
    moderation: null,
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
    if (arg === "--image") {
      cfg.image = argv[++i] || null;
      if (!cfg.image) throw new Error("Missing value for --image");
      continue;
    }
    if (arg === "--mask") {
      cfg.mask = argv[++i] || null;
      if (!cfg.mask) throw new Error("Missing value for --mask");
      continue;
    }
    if (arg === "--markup") {
      cfg.markup = argv[++i] || null;
      if (!cfg.markup) throw new Error("Missing value for --markup");
      continue;
    }
    if (arg === "--reference") {
      const reference = argv[++i] || null;
      if (!reference) throw new Error("Missing value for --reference");
      cfg.references.push(reference);
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
    if (arg === "--output") {
      cfg.output = argv[++i] || null;
      if (!cfg.output) throw new Error("Missing value for --output");
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
    if (arg === "--input-fidelity") {
      cfg.inputFidelity = argv[++i] || null;
      if (!cfg.inputFidelity) throw new Error("Missing value for --input-fidelity");
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
    if (arg === "--moderation") {
      cfg.moderation = argv[++i] || null;
      if (!cfg.moderation) throw new Error("Missing value for --moderation");
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return cfg;
}

function buildRequestUrl() {
  return `${buildBaseUrl()}/images/edits`;
}

async function buildForm(cfg, prompt, outputFormat) {
  const form = new FormData();
  const imagePath = cfg.image;
  const imageBytes = await readFile(imagePath);
  const imageField = cfg.references.length ? "image[]" : "image";
  form.append(imageField, new Blob([imageBytes], { type: mimeFor(imagePath) }), imagePath.split(/[\\/]/).pop());

  for (const referencePath of cfg.references) {
    const referenceBytes = await readFile(referencePath);
    form.append("image[]", new Blob([referenceBytes], { type: mimeFor(referencePath) }), referencePath.split(/[\\/]/).pop());
  }

  if (cfg.mask) {
    const maskBytes = await readFile(cfg.mask);
    form.append("mask", new Blob([maskBytes], { type: mimeFor(cfg.mask) }), cfg.mask.split(/[\\/]/).pop());
  }
  if (cfg.markup) {
    const markupBytes = await readFile(cfg.markup);
    form.append("markup", new Blob([markupBytes], { type: mimeFor(cfg.markup) }), cfg.markup.split(/[\\/]/).pop());
  }

  form.append("prompt", prompt);
  form.append("model", resolveImageModel("edit", cfg.model));
  appendIfPresent(form, "size", cfg.size);
  appendIfPresent(form, "n", cfg.n);
  appendIfPresent(form, "quality", cfg.quality);
  appendIfPresent(form, "complexity", cfg.complexity);
  appendIfPresent(form, "background", cfg.background);
  if (!/^gpt-image-2\.6(?:-|$)/.test(resolveImageModel("edit", cfg.model))) {
    appendIfPresent(form, "input_fidelity", cfg.inputFidelity);
  }
  appendIfPresent(form, "output_format", cfg.outputFormat || (outputFormat !== "png" ? outputFormat : null));
  appendIfPresent(form, "output_compression", cfg.outputCompression);
  appendIfPresent(form, "frame_count", cfg.frameCount);
  appendIfPresent(form, "frame_duration_ms", cfg.frameDurationMs);
  appendIfPresent(form, "moderation", cfg.moderation);
  return form;
}

async function run() {
  const cfg = parseCli(process.argv.slice(2));
  if (cfg.help) {
    printHelp();
    return;
  }

  if (!cfg.image) throw new Error("--image is required");

  await loadAmbientEnv();
  await ensureFilesExist([cfg.image, ...cfg.references, ...(cfg.mask ? [cfg.mask] : []), ...(cfg.markup ? [cfg.markup] : [])], "Image file");
  if (cfg.mask && cfg.markup) throw new Error("Use either --mask or --markup, not both.");
  if (cfg.markup && path.extname(cfg.markup).toLowerCase() !== ".png") {
    throw new Error("--markup must be a PNG overlay.");
  }
  const prompt = await readPromptInput(cfg.prompt, cfg.promptFile);
  const nameHint = slugify(prompt.split(/\s+/).slice(0, 8).join(" "), "edited-image");
  const formatSelection = resolveOutputFormat(cfg.outputFormat, cfg.output);
  const outputFormat = formatSelection.format;
  if (outputFormat === "svg") throw new Error("SVG output is available for generation only, not image edits.");
  cfg.outputFormat = formatSelection.shouldSend ? outputFormat : null;
  const count = cfg.n === null ? 1 : Number(cfg.n);
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("--n must be an integer from 1 to 10.");
  if (cfg.quality && !SUPPORTED_QUALITY_LEVELS.includes(cfg.quality)) {
    throw new Error(`Unsupported --quality value: ${cfg.quality}`);
  }
  if (cfg.complexity && !SUPPORTED_COMPLEXITY_LEVELS.includes(cfg.complexity)) {
    throw new Error(`Unsupported --complexity value: ${cfg.complexity}`);
  }
  const editModel = resolveImageModel("edit", cfg.model);
  if (cfg.inputFidelity && /^gpt-image-2\.6(?:-|$)/.test(editModel)) {
    throw new Error("--input-fidelity is not supported for GPT Image 2.6; omit it.");
  }
  validateModelSpecificOptions({ model: editModel, format: outputFormat, complexity: cfg.complexity });
  validateImageOutputOptions({
    format: outputFormat,
    n: count,
    compression: cfg.outputCompression,
    frameCount: cfg.frameCount,
    frameDurationMs: cfg.frameDurationMs,
  });
  const promptPath = await savePrompt(prompt, cfg.promptOutput, nameHint);
  const fallbackPath = buildDefaultImagePath("edit", nameHint, extensionForFormat(outputFormat));
  const form = await buildForm(cfg, prompt, outputFormat);
  const url = buildRequestUrl();
  const json = await postMultipart(url, form);
  const images = await extractGeneratedImages(json);
  const outputPaths = resolveOutputPaths(cfg.output, fallbackPath, outputFormat, images.length);
  await Promise.all(images.map((bytes, index) => saveImage(outputPaths[index], bytes)));

  if (cfg.json) {
    printJson({
      savedImage: outputPaths[0],
      savedImages: outputPaths,
      outputFormat,
      savedPrompt: promptPath,
      model: resolveImageModel("edit", cfg.model),
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
