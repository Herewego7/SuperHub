import { GoogleGenAI } from "@google/genai";
import { ObjectStorageService } from "./objectStorage";
import { splitIngredient } from "./recipeImport";

/**
 * "Snap a Recipe" — read one recipe out of one or more photos.
 *
 * Mirrors `flyerExtract.ts` (same Gemini setup, same model fallback ladder,
 * same object-storage download) with two deliberate differences:
 *
 *  1. **Multiple images, one recipe.** A recipe routinely doesn't fit in a
 *     single frame — ingredients on one page, directions continuing over the
 *     next two. All the images go into a SINGLE request as ordered parts, so
 *     the model can stitch them itself. Extracting each photo separately and
 *     merging afterwards would be much worse: it can't tell that step 4 on
 *     page 2 continues step 3 on page 1, and would duplicate anything
 *     appearing in the overlap between two photos.
 *  2. **Ingredient shape is shared with the URL importer** — `splitIngredient`
 *     from `recipeImport.ts` is reused verbatim, so a recipe added by photo
 *     and the same recipe added by link produce identical rows.
 */

export interface ExtractedRecipe {
  name: string;
  ingredients: { quantity: string | null; item: string }[];
  directions: string | null;
  /** Servings / prep-and-cook time / any other prose worth keeping. */
  notes: string | null;
  /** Set when the model flags unreadable or possibly-missing content. */
  warning: string | null;
  /** How many images actually contributed — echoed back for the UI. */
  imageCount: number;
}

/** Hard cap on images per request. */
export const MAX_RECIPE_IMAGES = 5;

/**
 * Total decoded-bytes ceiling across all images. Images arrive already
 * downscaled by the client (see lib/downscaleImage.ts), so this is a
 * backstop against a caller that skipped that, not the primary control —
 * base64 inflates by ~33%, so 15 MB decoded is ~20 MB on the wire.
 */
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

function fetchGemini(): GoogleGenAI {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (!apiKey || !baseUrl) {
    throw new Error("Gemini AI integration is not configured");
  }
  return new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
}

function inferImageMimeType(objectName: string, buffer?: Buffer): string {
  const lower = objectName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heic";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (buffer && buffer.length >= 12) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return "image/webp";
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return "image/gif";
  }
  return "image/jpeg";
}

function buildPrompt(imageCount: number): string {
  const multi = imageCount > 1;
  return `You are reading a recipe from ${imageCount} photo${multi ? "s" : ""} a parent just took.

${multi
  ? `The photos are pages/sections of ONE SINGLE recipe, given in order. Read them together and produce one combined recipe.
- Content continues across photos: ingredients may finish on a later photo, and the directions very often do.
- Photos may OVERLAP (the same lines visible at the bottom of one and the top of the next). Include overlapping content only ONCE — never repeat a step or ingredient just because it appears twice.
- Keep the original order across the photos. Do not reorder steps.`
  : `Read the single recipe shown.`}

These may be cookbook pages, handwritten recipe cards, magazine clippings, printouts, or a phone screenshot.

Return ONLY valid JSON matching this exact shape (no markdown, no code fences, no commentary):
{
  "name": "string",
  "ingredients": ["2 cups flour", "1 tsp salt"],
  "steps": ["Preheat the oven to 400F.", "Mix the dry ingredients."],
  "notes": "string or null",
  "warning": "string or null"
}

Rules:
- "name" is the recipe title as written. If no title is visible, use a short descriptive one based on the dish (e.g. "Banana Bread"). Never return an empty name when there is clearly a recipe.
- Each ingredient is ONE entry, transcribed as written INCLUDING its amount (e.g. "1 1/2 cups sugar"). Keep the original order. Do not convert units.
- Each step is ONE instruction. Strip any leading step numbers — they get renumbered later.
- "notes" is for servings, prep/cook/total time, oven temperature, source attribution, or a short note printed with the recipe. Combine them into one short string, or null if there are none. Do NOT put ingredients or steps in notes.
- "warning" — set a SHORT sentence if part of the recipe is cut off, blurry, or unreadable, or if the photos look like they may be missing a page. Otherwise null. Be honest here; a warning is far better than a silently incomplete recipe.
- Transcribe only what is actually visible. NEVER invent ingredients, steps, quantities, or times that you cannot read.
- If the photos contain no recipe at all, return {"name": "", "ingredients": [], "steps": [], "notes": null, "warning": "No recipe found in these photos."}`;
}

export async function extractRecipeFromImages(
  rawObjectURLs: string[],
): Promise<ExtractedRecipe> {
  if (!Array.isArray(rawObjectURLs) || rawObjectURLs.length === 0) {
    throw new Error("Add at least one photo of the recipe");
  }
  const urls = rawObjectURLs.slice(0, MAX_RECIPE_IMAGES);

  const objectStorage = new ObjectStorageService();
  const parts: { inlineData: { mimeType: string; data: string } }[] = [];
  let totalBytes = 0;

  for (const raw of urls) {
    const normalizedPath = objectStorage.normalizeObjectEntityPath(raw);
    if (!normalizedPath.startsWith("/objects/")) {
      throw new Error("Invalid uploaded image path");
    }
    const buffer = await objectStorage.downloadBytes(normalizedPath);
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(
        "Those photos are too large together. Try again with fewer photos, or retake them.",
      );
    }
    parts.push({
      inlineData: {
        mimeType: inferImageMimeType(normalizedPath, buffer),
        data: buffer.toString("base64"),
      },
    });
  }

  const ai = fetchGemini();
  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
  let text = "";
  let lastError: unknown;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            // Prompt first, then every image in the order the user picked
            // them — that ordering is what lets the model stitch pages.
            parts: [{ text: buildPrompt(parts.length) }, ...parts],
          },
        ],
        // A long recipe with many steps needs materially more room than the
        // flyer extractor's events do.
        config: { maxOutputTokens: 8192 },
      });
      text = response.text || "";
      if (text) break;
    } catch (err) {
      console.warn(`Recipe extract: model ${model} failed:`, err instanceof Error ? err.message : err);
      lastError = err;
    }
  }

  if (!text) {
    throw lastError instanceof Error ? lastError : new Error("AI service returned an empty response");
  }

  return shapeExtraction(text, parts.length);
}

/**
 * Turn the model's raw reply into an ExtractedRecipe, or throw a user-facing
 * error. Exported for unit testing — this is the whole non-network half of
 * the extractor, and the part most likely to meet surprising model output.
 */
export function shapeExtraction(text: string, imageCount: number): ExtractedRecipe {
  const parsed = parseModelJson(text);
  if (!parsed) {
    throw new Error("Couldn't read a recipe from those photos. Try again with clearer, straight-on shots.");
  }

  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  const ingredientLines: string[] = Array.isArray(parsed.ingredients)
    ? parsed.ingredients.filter((x: unknown): x is string => typeof x === "string" && !!x.trim())
    : [];
  const steps: string[] = Array.isArray(parsed.steps)
    ? parsed.steps.filter((x: unknown): x is string => typeof x === "string" && !!x.trim())
    : [];

  if (!name && !ingredientLines.length && !steps.length) {
    throw new Error(
      typeof parsed.warning === "string" && parsed.warning
        ? parsed.warning
        : "Couldn't find a recipe in those photos. Try again with clearer, straight-on shots.",
    );
  }

  return {
    name,
    ingredients: ingredientLines.map(splitIngredient).filter((i) => i.item),
    // Renumber ourselves so the result is consistent whether the model
    // emitted numbers or not (the prompt asks it not to, but models drift).
    directions: steps.length
      ? steps.map((s, i) => `${i + 1}. ${s.replace(/^\s*\d+[.)]\s*/, "").trim()}`).join("\n")
      : null,
    notes: typeof parsed.notes === "string" && parsed.notes.trim() ? parsed.notes.trim() : null,
    warning: typeof parsed.warning === "string" && parsed.warning.trim() ? parsed.warning.trim() : null,
    imageCount,
  };
}

/** Tolerate code fences and leading/trailing prose around the JSON. */
function parseModelJson(text: string): any | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
