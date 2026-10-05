/**
 * Gemini for SuperHub. Bot Life's Google Cloud project (Vertex) is preferred
 * so trial credits are used. Replit's managed proxy remains a fallback.
 */
import { GoogleGenAI } from "@google/genai";
import { type ModelJob, withModelRetry } from "./ai/modelRetry";

export type GeminiEnv = {
  GOOGLE_CLOUD_PROJECT?: string;
  GOOGLE_CLOUD_LOCATION?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  AI_INTEGRATIONS_GEMINI_API_KEY?: string;
  AI_INTEGRATIONS_GEMINI_BASE_URL?: string;
};

export type GeminiSetup =
  | { kind: "vertex"; project: string; location: string; credentials: { client_email: string; private_key: string } }
  | { kind: "replit"; apiKey: string; baseUrl: string }
  | { kind: "off" };

export function geminiSetup(env: GeminiEnv = process.env): GeminiSetup {
  const project = env.GOOGLE_CLOUD_PROJECT?.trim();
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (project && raw) {
    try {
      const parsed = JSON.parse(raw) as { client_email?: unknown; private_key?: unknown };
      if (typeof parsed.client_email === "string" && parsed.client_email && typeof parsed.private_key === "string" && parsed.private_key) {
        return {
          kind: "vertex",
          project,
          // Gemini 3 is served from global. A regional default 404s the chat model.
          location: env.GOOGLE_CLOUD_LOCATION?.trim() || "global",
          credentials: { client_email: parsed.client_email, private_key: parsed.private_key },
        };
      }
    } catch {
      /* A bad secret falls through to the Replit proxy, if that is set. */
    }
  }
  const apiKey = env.AI_INTEGRATIONS_GEMINI_API_KEY?.trim();
  const baseUrl = env.AI_INTEGRATIONS_GEMINI_BASE_URL?.trim();
  if (apiKey && baseUrl) return { kind: "replit", apiKey, baseUrl };
  return { kind: "off" };
}

export function geminiClient(env: GeminiEnv = process.env): GoogleGenAI | null {
  const setup = geminiSetup(env);
  if (setup.kind === "vertex") {
    return new GoogleGenAI({
      vertexai: true,
      project: setup.project,
      location: setup.location,
      googleAuthOptions: { credentials: setup.credentials },
    });
  }
  if (setup.kind === "replit") {
    return new GoogleGenAI({ apiKey: setup.apiKey, httpOptions: { apiVersion: "", baseUrl: setup.baseUrl } });
  }
  return null;
}

/**
 * Bot Life's job table (functions/src/ai/registry.ts). SuperHub uses these
 * names. A test fails if chat grows its own token cap again.
 */
export const BOTLIFE_MODELS = {
  triage: "gemini-3.1-flash-lite",
  extract: "gemini-3.5-flash",
  extractComplex: "gemini-3.1-pro-preview",
  newsletter: "gemini-3.1-pro-preview",
  dedupe: "gemini-3.1-flash-lite",
  digest: "gemini-3.5-flash",
  chat: "gemini-3.1-pro-preview",
  draft: "gemini-3.5-flash",
  embed: "gemini-embedding-001",
} as const;

/** Bot Life chat: temperature 0.3, and no output cap of our own. */
export function chatGenerationConfig(): { temperature: number } {
  return { temperature: 0.3 };
}

/** Structured reads stay at 0. The evening-plan rewrite uses 0.3, same as Bot Life. */
export function jsonGenerationConfig(job?: ModelJob): { temperature: number; responseMimeType: string } {
  return { temperature: job === "digest" ? 0.3 : 0, responseMimeType: "application/json" };
}

export async function askJson(
  ai: GoogleGenAI,
  models: string[],
  system: string,
  prompt: string,
  image?: { mimeType: string; data: string } | { mimeType: string; data: string }[],
  job: ModelJob = "extract",
): Promise<unknown | null> {
  const files = image ? (Array.isArray(image) ? image : [image]) : [];
  const parts = [
    { text: prompt },
    ...files.map((file) => ({ inlineData: { mimeType: file.mimeType, data: file.data } })),
  ];
  for (const model of models) {
    try {
      const response = await withModelRetry(job, (signal) => ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: { systemInstruction: system, ...jsonGenerationConfig(job), abortSignal: signal },
      }));
      const cleaned = (response.text || "").replace(/```json|```/g, "").trim();
      if (!cleaned) continue;
      return JSON.parse(cleaned) as unknown;
    } catch (err) {
      console.warn("Gemini JSON failed:", err instanceof Error ? err.message : err);
    }
  }
  return null;
}

export function requireGemini(env: GeminiEnv = process.env): GoogleGenAI {
  const client = geminiClient(env);
  if (!client) throw new Error("Gemini AI integration is not configured");
  return client;
}
