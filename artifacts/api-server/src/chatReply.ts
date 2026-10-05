/**
 * One chat turn: Gemini calls SuperHub tools, then the route saves whatever
 * those tools decided. No key, or a Google/Outlook change, hands the turn
 * back to the phrase matcher.
 */
import { GoogleGenAI } from "@google/genai";
import { type ChatAction, type ChatSnapshot, handleToolCall, chatSystemPrompt, toolDeclarations, userSaidYes } from "./chatBrain";
import { geminiClient } from "./geminiClient";

export type ChatHistory = { role: "user" | "assistant"; text: string }[];

export type ChatBrainResult =
  | { fallback: true }
  | { fallback: false; text: string; actions: ChatAction[] };

type ModelCall = { name: string; args: Record<string, unknown> };

type ModelTurn = { text: string; calls: ModelCall[]; modelParts: unknown[] };

const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
const MAX_ROUNDS = 4;

function configured(): GoogleGenAI | null {
  return geminiClient();
}

async function generate(ai: GoogleGenAI, system: string, contents: unknown[], tools: ReturnType<typeof toolDeclarations>): Promise<ModelTurn | null> {
  let last: unknown;
  for (const model of MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: contents as never,
        config: {
          systemInstruction: system,
          maxOutputTokens: 1024,
          tools: [{ functionDeclarations: tools as never }],
        },
      });
      const parts = (response.candidates?.[0]?.content?.parts ?? []) as { text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }[];
      const calls = parts.flatMap((part) => part.functionCall?.name ? [{ name: part.functionCall.name, args: part.functionCall.args ?? {} }] : []);
      return { text: response.text?.trim() || parts.map((part) => part.text || "").join("").trim(), calls, modelParts: parts };
    } catch (err) {
      last = err;
    }
  }
  if (last) console.warn("Chat model failed:", last instanceof Error ? last.message : last);
  return null;
}

export async function replyWithChat(snap: ChatSnapshot, history: ChatHistory, text: string): Promise<ChatBrainResult> {
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
    const turn = await generate(ai, system, contents, tools);
    if (!turn) return { fallback: true };
    if (turn.calls.length === 0) {
      answer = turn.text;
      break;
    }
    if (turn.text) answer = turn.text;
    contents.push({ role: "model", parts: turn.modelParts });
    const responses = [];
    for (const call of turn.calls) {
      const handled = handleToolCall(call.name, call.args, snap, saidYes);
      if (handled.handoff) return { fallback: true };
      if (handled.action) actions.push(handled.action);
      responses.push({ functionResponse: { name: call.name, response: handled.output } });
    }
    contents.push({ role: "user", parts: responses });
  }
  return { fallback: false, text: answer || (actions.length ? "Done." : "Sorry, I didn't catch that. Could you say it another way?"), actions };
}
