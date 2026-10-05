/**
 * Dismissed mail and saved excerpts. A missing table leaves search on the
 * household already loaded into chat, and the scan keeps going.
 */
import { and, desc, eq } from "drizzle-orm";
import { aiRecords, db } from "@workspace/db";
import { BOTLIFE_MODELS, geminiClient } from "../geminiClient";
import { withModelRetry } from "./modelRetry";
import { cosine, searchChunks, similarExamples } from "./parity";

export async function rememberRecord(userId: string, kind: "example" | "chunk", text: string, ref?: string): Promise<void> {
  const trimmed = text.replace(/\s+/g, " ").trim().slice(0, 2000);
  if (!trimmed) return;
  try {
    const embedding = await embed(trimmed);
    await db.insert(aiRecords).values({ userId, kind, text: trimmed, ref: ref ?? null, embedding });
  } catch (err) {
    console.warn("AI memory skipped:", err instanceof Error ? err.message : err);
  }
}

export async function recentRecords(userId: string, kind: "example" | "chunk", limit = 40): Promise<{ text: string; embedding: number[] | null }[]> {
  try {
    const rows = await db.select({ text: aiRecords.text, embedding: aiRecords.embedding })
      .from(aiRecords)
      .where(and(eq(aiRecords.userId, userId), eq(aiRecords.kind, kind)))
      .orderBy(desc(aiRecords.createdAt))
      .limit(limit);
    return rows.filter((row) => row.text).map((row) => ({ text: row.text, embedding: row.embedding ?? null }));
  } catch {
    return [];
  }
}

export async function examplesFor(userId: string): Promise<string[]> {
  const rows = await recentRecords(userId, "example", 200);
  return rows.map((row) => row.text);
}

/** Up to three earlier "not relevant" notes that look like this message. */
export async function examplesForMessage(userId: string, text: string, sender?: string): Promise<string[]> {
  const rows = await recentRecords(userId, "example", 200);
  const vector = await embed(text);
  return similarExamples(rows, vector, sender);
}

/** Saves the letter itself, in up to eight pieces, so a later question can find the mail. */
export async function rememberMail(userId: string, text: string, ref?: string): Promise<void> {
  const parts = searchChunks(text);
  for (const part of parts) await rememberRecord(userId, "chunk", part, ref);
}

async function embed(text: string): Promise<number[] | null> {
  const ai = geminiClient();
  if (!ai) return null;
  try {
    const response = await withModelRetry("embed", (signal) => ai.models.embedContent({
      model: BOTLIFE_MODELS.embed,
      contents: text.slice(0, 2000),
      config: { outputDimensionality: 768, abortSignal: signal },
    }));
    const values = response.embeddings?.[0]?.values;
    return Array.isArray(values) ? values : null;
  } catch {
    return null;
  }
}

function keywordScore(query: string, text: string): number {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  if (words.length === 0) return 0;
  const hay = text.toLowerCase();
  return words.filter((word) => hay.includes(word)).length / words.length;
}

export async function searchMemory(userId: string, query: string): Promise<string[]> {
  const rows = await recentRecords(userId, "chunk", 400);
  const vector = await embed(query);
  return rows
    .map((row) => {
      const similar = vector && row.embedding ? Math.max(0, cosine(vector, row.embedding)) : 0;
      const words = keywordScore(query, row.text);
      const score = vector ? 0.6 * similar + 0.4 * words : words;
      return { text: row.text, score };
    })
    .filter((row) => row.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((row) => row.text);
}
