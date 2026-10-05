/**
 * One chat turn: Gemini calls SuperHub tools, then the route saves whatever
 * those tools decided. A Google or Outlook edit hands the turn back to the
 * phrase matcher. A failed model call does not — Bot Life shows its own
 * sentence instead, and so do we.
 *
 * The reply is one complete generateContent call. Streaming this through
 * Vertex's SSE parser dropped the answer and the page substituted the spare
 * "I can tell you the plan" line. Bot Life streams through Genkit, which
 * does not hit that parser.
 */
import { GoogleGenAI } from "@google/genai";
import { type ChatAction, type ChatSnapshot, handleToolCall, chatSystemPrompt, toolDeclarations, userSaidYes } from "./chatBrain";
import { forecastForPlace } from "./ai/weather";
import { withModelRetry } from "./ai/modelRetry";
import { BOTLIFE_MODELS, chatGenerationConfig, geminiClient } from "./geminiClient";
import { dinnerConfirmText } from "./meals/assignDinner";

export type ChatHistory = { role: "user" | "assistant"; text: string }[];

export type ChatBrainResult =
  | { fallback: true }
  | { fallback: false; text: string; actions: ChatAction[] };

type ModelCall = { name: string; args: Record<string, unknown> };

type ModelTurn = { text: string; calls: ModelCall[]; modelParts: unknown[] };

export const MAX_ROUNDS = 5;

function dinnersFrom(output: unknown): { date: string; name: string }[] {
  const dinners = output && typeof output === "object" && "dinners" in output ? (output as { dinners?: unknown }).dinners : null;
  if (!Array.isArray(dinners)) return [];
  return dinners.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const date = typeof (row as { date?: unknown }).date === "string" ? (row as { date: string }).date : "";
    const name = typeof (row as { name?: unknown }).name === "string" ? (row as { name: string }).name : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && name ? [{ date, name }] : [];
  });
}

/** Same sentence Bot Life stores when the model call fails. */
export const CHAT_PROBLEM = "Sorry, I hit a problem answering that. Please try again in a moment.";

function configured(): GoogleGenAI | null {
  return geminiClient();
}

async function generate(ai: GoogleGenAI, system: string, contents: unknown[], tools: ReturnType<typeof toolDeclarations>): Promise<ModelTurn | null> {
  try {
    const response = await withModelRetry("chat", (signal) => ai.models.generateContent({
      model: BOTLIFE_MODELS.chat,
      contents: contents as never,
      config: {
        systemInstruction: system,
        ...chatGenerationConfig(),
        tools: [{ functionDeclarations: tools as never }],
        abortSignal: signal,
      },
    }));
    const parts = (response.candidates?.[0]?.content?.parts ?? []) as { text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }[];
    const calls = parts.flatMap((part) => part.functionCall?.name ? [{ name: part.functionCall.name, args: part.functionCall.args ?? {} }] : []);
    const text = (response.text?.trim() || parts.map((part) => part.text || "").join("")).trim();
    return { text, calls, modelParts: parts };
  } catch (err) {
    console.warn("Chat model failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function replyWithChat(snap: ChatSnapshot, history: ChatHistory, text: string): Promise<ChatBrainResult> {
  const ai = configured();
  if (!ai) return { fallback: false, text: CHAT_PROBLEM, actions: [] };
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
    const turn = await generate(ai, system, contents, tools);
    if (!turn) return { fallback: false, text: answer || CHAT_PROBLEM, actions };
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
      const nights = call.name === "plan_dinners" && !handled.action ? dinnersFrom(handled.output) : [];
      if (nights.length > 0) return { fallback: false, text: dinnerConfirmText(nights), actions };
      const choreAsk = call.name === "create_chore" && !handled.action && handled.output && typeof handled.output === "object" && typeof (handled.output as { ask?: unknown }).ask === "string"
        ? (handled.output as { ask: string }).ask
        : "";
      if (choreAsk) return { fallback: false, text: choreAsk, actions: [] };
      const eventAsk = call.name === "create_event" && !handled.action && handled.output && typeof handled.output === "object" && typeof (handled.output as { ask?: unknown }).ask === "string"
        ? (handled.output as { ask: string }).ask
        : "";
      if (eventAsk) return { fallback: false, text: eventAsk, actions: [] };
      if (handled.action) actions.push(handled.action);
      responses.push({ functionResponse: { name: call.name, response: handled.output } });
    }
    contents.push({ role: "user", parts: responses });
  }
  return { fallback: false, text: answer || (actions.length ? "Done." : "Sorry, I didn't catch that. Could you say it another way?"), actions };
}
