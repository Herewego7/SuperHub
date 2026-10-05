/**
 * Bot Life retries a model call Google was too busy to answer, and cuts off a
 * call that hangs so it can be tried again. Chat, drafts, and search wait a
 * few seconds. Reading mail waits longer.
 */

export type ModelJob =
  | "triage"
  | "extract"
  | "extractComplex"
  | "newsletter"
  | "dedupe"
  | "digest"
  | "chat"
  | "draft"
  | "embed";

export interface RetryPolicy {
  tries: number;
  baseMs: number;
  capMs: number;
}

export const QUICK: RetryPolicy = { tries: 3, baseMs: 1_000, capMs: 4_000 };
export const PATIENT: RetryPolicy = { tries: 6, baseMs: 2_000, capMs: 32_000 };

const QUICK_JOBS: ReadonlySet<ModelJob> = new Set(["chat", "draft", "embed"]);

export function retryPolicy(job: ModelJob): RetryPolicy {
  return QUICK_JOBS.has(job) ? QUICK : PATIENT;
}

/** Chat 60s, a draft 30s, a long letter 3 minutes, everything else 90s. */
export function answerLimitMs(job: ModelJob): number {
  if (job === "draft") return 30_000;
  if (job === "chat") return 60_000;
  if (job === "extractComplex" || job === "newsletter") return 180_000;
  return 90_000;
}

export function retryReason(err: unknown): "busy" | "noAnswer" | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const { status, code, name, message } = err as { status?: unknown; code?: unknown; name?: unknown; message?: unknown };
  if (status === "RESOURCE_EXHAUSTED" || status === "UNAVAILABLE" || status === 429 || status === 503) return "busy";
  if (code === 429 || code === 503) return "busy";
  if (name === "AbortError" || name === "TimeoutError") return "noAnswer";
  if (typeof message === "string" && message.startsWith("Failed to fetch from ")) return "noAnswer";
  return undefined;
}

export function retryDelayMs(policy: RetryPolicy, attempt: number, random: () => number = Math.random): number {
  return Math.round(random() * Math.min(policy.capMs, policy.baseMs * 2 ** (attempt - 1)));
}

export async function withModelRetry<T>(
  job: ModelJob,
  call: (signal: AbortSignal) => Promise<T>,
  options: { sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<T> {
  const policy = retryPolicy(job);
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await call(AbortSignal.timeout(answerLimitMs(job)));
    } catch (err) {
      if (!retryReason(err) || attempt >= policy.tries) throw err;
      const delayMs = retryDelayMs(policy, attempt, options.random ?? Math.random);
      console.warn("model call failed; retrying", { job, attempt, delayMs });
      await sleep(delayMs);
    }
  }
}
