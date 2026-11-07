import path from "node:path";
import process from "node:process";
import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export const DEFAULT_IMAGE_DIR = "garden-gpt-image-2/image";
export const DEFAULT_PROMPT_DIR = "garden-gpt-image-2/prompt";
export const DEFAULT_GENERATION_MODEL = "gpt-image-2.5-flare";
export const DEFAULT_EDIT_MODEL = "gpt-image-2.5-sunburst";
// Backward-compatible alias for callers that still import DEFAULT_MODEL.
export const DEFAULT_MODEL = DEFAULT_GENERATION_MODEL;
export const SUPPORTED_IMAGE_MODELS = [
  DEFAULT_GENERATION_MODEL,
  DEFAULT_EDIT_MODEL,
  "gpt-image-2.6-flare",
  "gpt-image-2.6-sunburst",
];
export const SUPPORTED_QUALITY_LEVELS = ["auto", "low", "medium", "high", "xhigh", "max"];
export const SUPPORTED_COMPLEXITY_LEVELS = ["low", "medium", "high"];
export const SUPPORTED_OUTPUT_FORMATS = ["png", "jpeg", "webp", "gif", "svg"];

const FORMAT_EXTENSIONS = {
  png: ".png",
  jpeg: ".jpg",
  webp: ".webp",
  gif: ".gif",
  svg: ".svg",
};
const EXTENSION_FORMATS = {
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".webp": "webp",
  ".gif": "gif",
  ".svg": "svg",
};

export function resolveImageModel(kind, cliModel) {
  if (cliModel) return cliModel;
  const operationModel =
    kind === "edit"
      ? process.env.OPENAI_IMAGE_EDIT_MODEL
      : process.env.OPENAI_IMAGE_GENERATION_MODEL;
  return (
    operationModel ||
    process.env.OPENAI_IMAGE_MODEL ||
    (kind === "edit" ? DEFAULT_EDIT_MODEL : DEFAULT_GENERATION_MODEL)
  );
}

export function resolveOutputFormat(configuredFormat, rawOutputPath) {
  const outputExtension = path.extname(String(rawOutputPath || "")).toLowerCase();
  const pathFormat = outputExtension ? EXTENSION_FORMATS[outputExtension] : null;
  if (outputExtension && !pathFormat) {
    throw new Error(`Unsupported output file extension: ${outputExtension}`);
  }

  const format = String(configuredFormat || pathFormat || "png").toLowerCase();
  if (!SUPPORTED_OUTPUT_FORMATS.includes(format)) {
    throw new Error(`Unsupported output format: ${format}. Supported: ${SUPPORTED_OUTPUT_FORMATS.join(", ")}`);
  }
  if (configuredFormat && pathFormat && format !== pathFormat) {
    throw new Error(`--output-format ${format} conflicts with output path extension ${outputExtension}`);
  }

  return {
    format,
    shouldSend: Boolean(configuredFormat || (pathFormat && pathFormat !== "png")),
  };
}

export function extensionForFormat(format) {
  const extension = FORMAT_EXTENSIONS[String(format || "png").toLowerCase()];
  if (!extension) throw new Error(`Unsupported output format: ${format}`);
  return extension;
}

export function validateImageOutputOptions({ format, n = 1, compression, frameCount, frameDurationMs }) {
  if (!SUPPORTED_OUTPUT_FORMATS.includes(format)) {
    throw new Error(`Unsupported output format: ${format}. Supported: ${SUPPORTED_OUTPUT_FORMATS.join(", ")}`);
  }
  if (compression !== null && compression !== undefined && !["jpeg", "webp"].includes(format)) {
    throw new Error("--output-compression is only valid with jpeg or webp output.");
  }
  if (compression !== null && compression !== undefined) {
    const value = Number(compression);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new Error("--output-compression must be an integer from 0 to 100.");
    }
  }
  if (format !== "gif" && ((frameCount !== null && frameCount !== undefined) || (frameDurationMs !== null && frameDurationMs !== undefined))) {
    throw new Error("--frame-count and --frame-duration-ms require --output-format gif.");
  }
  if (frameCount !== null && frameCount !== undefined) {
    const value = Number(frameCount);
    if (!Number.isInteger(value) || value < 2 || value > 16) {
      throw new Error("--frame-count must be an integer from 2 to 16.");
    }
  }
  if (frameDurationMs !== null && frameDurationMs !== undefined) {
    const value = Number(frameDurationMs);
    if (!Number.isInteger(value) || value < 20 || value > 2000) {
      throw new Error("--frame-duration-ms must be an integer from 20 to 2000; the API rounds to 10 ms.");
    }
  }
  if (format === "svg" && Number(n) > 1) {
    throw new Error("SVG output supports one image per request; set --n 1.");
  }
}

export function validateModelSpecificOptions({ model, format, complexity }) {
  const isGptImage2Family = /^gpt-image-2(?:[.-]|$)/.test(String(model || ""));
  const isGptImage26 = /^gpt-image-2\.6(?:-|$)/.test(String(model || ""));
  if (isGptImage2Family && !isGptImage26) {
    if (complexity) {
      throw new Error("--complexity requires GPT Image 2.6; select gpt-image-2.6-flare or gpt-image-2.6-sunburst.");
    }
    if (format === "gif" || format === "svg") {
      throw new Error(`--output-format ${format} requires GPT Image 2.6; select gpt-image-2.6-flare or gpt-image-2.6-sunburst.`);
    }
  }
}

export async function readEnvFile(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    const result = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const pivot = trimmed.indexOf("=");
      if (pivot === -1) continue;
      const key = trimmed.slice(0, pivot).trim();
      let value = trimmed.slice(pivot + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

export async function loadAmbientEnv() {
  const places = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), ".gateway.env"),
    path.join(homedir(), ".gateway.env"),
  ];

  for (const filePath of places) {
    const pairs = await readEnvFile(filePath);
    for (const [key, value] of Object.entries(pairs)) {
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

export async function readPromptInput(prompt, promptFile) {
  if (prompt) return prompt.trim();
  if (promptFile) {
    const text = await readFile(path.resolve(promptFile), "utf8");
    return text.trim();
  }
  throw new Error("Prompt is required. Use --prompt or --promptfile.");
}

export function slugify(value, fallback = "image-task") {
  const base = String(value || "").trim().toLowerCase();
  const ascii = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return ascii || fallback;
}

export function makeTimestamp() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

export function buildDefaultImagePath(kind, hint, ext = ".png") {
  const stamp = makeTimestamp();
  const slug = slugify(hint, kind === "edit" ? "edited-image" : "generated-image");
  const file = `${slug}-${stamp}${ext}`;
  return path.join(DEFAULT_IMAGE_DIR, file);
}

export function buildDefaultPromptPath(hint) {
  const stamp = makeTimestamp();
  const slug = slugify(hint, "prompt");
  return path.join(DEFAULT_PROMPT_DIR, `${slug}-${stamp}.md`);
}

export function resolveOutput(raw, fallbackPath, outputFormat = "png") {
  const target = raw || fallbackPath;
  const full = path.resolve(target);
  return path.extname(full) ? full : `${full}${extensionForFormat(outputFormat)}`;
}

export function resolveOutputPaths(raw, fallbackPath, outputFormat, count) {
  const firstPath = resolveOutput(raw, fallbackPath, outputFormat);
  const total = Math.max(1, Number(count) || 1);
  if (total === 1) return [firstPath];

  const extension = path.extname(firstPath);
  const stem = firstPath.slice(0, -extension.length);
  return Array.from({ length: total }, (_, index) => `${stem}-${index + 1}${extension}`);
}

export async function savePrompt(promptText, rawPath, hint) {
  const finalPath = path.resolve(rawPath || buildDefaultPromptPath(hint));
  await mkdir(path.dirname(finalPath), { recursive: true });
  await writeFile(finalPath, `${promptText.trim()}\n`, "utf8");
  return finalPath;
}

export function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  return "image/png";
}

export async function ensureFilesExist(files, label) {
  for (const item of files) {
    try {
      await readFile(path.resolve(item));
    } catch {
      throw new Error(`${label} not found: ${path.resolve(item)}`);
    }
  }
}

export async function encodeImages(files) {
  const images = [];
  for (const file of files) {
    const absolute = path.resolve(file);
    const bytes = await readFile(absolute);
    images.push({
      name: path.basename(absolute),
      mime_type: mimeFor(absolute),
      data: Buffer.from(bytes).toString("base64"),
      absolute,
    });
  }
  return images;
}

export function buildBaseUrl() {
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
}

export function requireApiKey() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required.");
  return apiKey;
}

export async function postJson(url, payload) {
  const apiKey = requireApiKey();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Image API error (${res.status}): ${text}`);
  }

  return res.json();
}

export async function postMultipart(url, form) {
  const apiKey = requireApiKey();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Image API error (${res.status}): ${text}`);
  }

  return res.json();
}

export async function fetchBytesFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to download generated image (${res.status}): ${text}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function extractGeneratedImages(json) {
  const items = json?.data;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("API response did not include any generated images in data[].");
  }
  return Promise.all(items.map(async (item, index) => {
    if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
    if (item?.url) return fetchBytesFromUrl(item.url);
    throw new Error(`API response data[${index}] did not include b64_json or url.`);
  }));
}

export async function extractGeneratedBytes(json) {
  return (await extractGeneratedImages(json))[0];
}

export async function saveImage(outputPath, bytes) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
}

export function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

export function appendIfPresent(target, key, value) {
  if (value === undefined || value === null || value === "") return;
  target.append(key, String(value));
}
