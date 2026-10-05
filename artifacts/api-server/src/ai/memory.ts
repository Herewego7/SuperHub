/**
 * Dismissed mail and saved excerpts. A missing table leaves search on the
 * household already loaded into chat, and the scan keeps going.
 */
import { and, desc, eq } from "drizzle-orm";
import { aiRecords, db } from "@workspace/db";
import { BOTLIFE_MODELS, geminiClient } from "../geminiClient";
import { cosine } from "./parity";

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
  const rows = await recentRecords(userId, "example", 12);
  return rows.map((row) => row.text);
}

async function embed(text: string): Promise<number[] | null> {
  const ai = geminiClient();
  if (!ai) return null;
  try {
    const response = await ai.models.embedContent({
      model: BOTLIFE_MODELS.embed,
      contents: text.slice(0, 2000),
      config: { outputDimensionality: 768 },
    });
    const values = response.embeddings?.[0]?.values;
    return Array.isArray(values) ? values : null;
  } catch {
    return null;
  }
}

export async function searchMemory(userId: string, query: string): Promise<string[]> {
  const rows = await recentRecords(userId, "chunk", 80);
  const vector = await embed(query);
  if (!vector) return rows.map((row) => row.text).filter((text) => query.split(/\s+/).some((word) => word.length > 2 && text.toLowerCase().includes(word.toLowerCase()))).slice(0, 8);
  return rows
    .map((row) => ({ text: row.text, score: row.embedding ? cosine(vector, row.embedding) : 0 }))
    .filter((row) => row.score > 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((row) => row.text);
}
