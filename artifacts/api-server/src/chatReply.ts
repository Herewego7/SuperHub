/**
 * One chat turn: Gemini calls SuperHub tools, then the route saves whatever
 * those tools decided. No key, or a Google/Outlook change, hands the turn
 * back to the phrase matcher.
 */
import { GoogleGenAI } from "@google/genai";
import { type ChatAction, type ChatSnapshot, handleToolCall, chatSystemPrompt, toolDeclarations, userSaidYes } from "./chatBrain";
import { forecastForPlace } from "./ai/weather";
import { retryDelayMs, retryPolicy, retryReason } from "./ai/modelRetry";
import { BOTLIFE_MODELS, chatGenerationConfig, geminiClient } from "./geminiClient";

export type ChatHistory = { role: "user" | "assistant"; text: string }[];

export type ChatBrainResult =
  | { fallback: true }
  | { fallback: false; text: string; actions: ChatAction[] };

type ModelCall = { name: string; args: Record<string, unknown> };

type ModelTurn = { text: string; calls: ModelCall[]; modelParts: unknown[] };

export const MAX_ROUNDS = 5;

function configured(): GoogleGenAI | null {
  return geminiClient();
}

type StreamPart = { text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } };

async function generate(ai: GoogleGenAI, system: string, contents: unknown[], tools: ReturnType<typeof toolDeclarations>, onDelta?: (chunk: string) => void): Promise<ModelTurn | null> {
  let last: unknown;
  for (const model of [BOTLIFE_MODELS.chat]) {
    const policyTries = 3;
    for (let attempt = 1; attempt <= policyTries; attempt++) {
      let started = false;
      try {
        const stream = await ai.models.generateContentStream({
          model,
          contents: contents as never,
          config: {
            systemInstruction: system,
            ...chatGenerationConfig(),
            tools: [{ functionDeclarations: tools as never }],
            abortSignal: AbortSignal.timeout(60_000),
          },
        });
        const parts: StreamPart[] = [];
        const streamedCalls: ModelCall[] = [];
        let text = "";
        let sawCall = false;
        for await (const chunk of stream) {
          started = true;
          for (const call of chunk.functionCalls ?? []) {
            if (!call.name) continue;
            sawCall = true;
            streamedCalls.push({ name: call.name, args: call.args ?? {} });
          }
          const chunkParts = (chunk.candidates?.[0]?.content?.parts ?? []) as StreamPart[];
          const chunkText = chunkParts.map((part) => part.text || "").join("");
          for (const part of chunkParts) {
            parts.push(part);
            if (part.functionCall) sawCall = true;
          }
          const delta = chunkText || (!chunkParts.length && chunk.text ? chunk.text : "");
          if (delta) {
            text += delta;
            if (!sawCall) onDelta?.(delta);
          }
        }
        const fromParts = parts.flatMap((part) => part.functionCall?.name ? [{ name: part.functionCall.name, args: part.functionCall.args ?? {} }] : []);
        const calls = fromParts.length ? fromParts : streamedCalls;
        return { text: text.trim(), calls, modelParts: parts };
      } catch (err) {
        last = err;
        if (started || !retryReason(err) || attempt >= retryPolicy("chat").tries) break;
        const delayMs = retryDelayMs(retryPolicy("chat"), attempt);
        console.warn("model call failed; retrying", { job: "chat", attempt, delayMs });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  if (last) console.warn("Chat model failed:", last instanceof Error ? last.message : last);
  return null;
}

export async function replyWithChat(snap: ChatSnapshot, history: ChatHistory, text: string, onDelta?: (chunk: string) => void): Promise<ChatBrainResult> {
  const ai = configured();
  if (!ai) return { fallback: true };
  const saidYes = userSaidYes(text);
  const system = chatSystemPrompt(snap);
  const tools = toolDeclarations(snap.isChild);
  const contents: unknown[] = [
    ...history.slice(-12).map((turn) => ({ role: turn.role === "assistant" ? "model" : "user", parts: [{ text: turn.text }] })),
    { role: "user", parts: [{ text }] },
  ];
  const actions: ChatAction[] = [];
  let answer = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const turn = await generate(ai, system, contents, tools, onDelta);
    if (!turn) return { fallback: true };
    if (turn.calls.length === 0) {
      answer = turn.text;
      break;
    }
    if (turn.text) answer = turn.text;
    contents.push({ role: "model", parts: turn.modelParts });
    const responses = [];
    for (const call of turn.calls) {
      if (call.name === "search" && snap.findMail) {
        const local = handleToolCall(call.name, call.args, { ...snap, notes: [] }, saidYes);
        const query = typeof call.args.query === "string" ? call.args.query : "";
        const mail = await snap.findMail(query);
        const listed = (local.output as { results?: { title: string; text: string; kind: string }[] }).results ?? [];
        const results = [
          ...listed,
          ...mail.map((text) => ({ title: text.slice(0, 80), text, kind: "mail" })),
        ].slice(0, 8);
        responses.push({ functionResponse: { name: call.name, response: { results } } });
        continue;
      }
      const place = call.name === "get_weather" && typeof call.args.place === "string" ? call.args.place.trim() : "";
      const handled = place
        ? { output: await forecastForPlace(place, typeof call.args.date === "string" ? call.args.date : "", snap.temperatureUnit ?? "fahrenheit"), action: null, handoff: false }
        : handleToolCall(call.name, call.args, snap, saidYes);
      if (handled.handoff) return { fallback: true };
      if (handled.action) actions.push(handled.action);
      responses.push({ functionResponse: { name: call.name, response: handled.output } });
    }
    contents.push({ role: "user", parts: responses });
  }
  return { fallback: false, text: answer || (actions.length ? "Done." : "Sorry, I didn't catch that. Could you say it another way?"), actions };
}
