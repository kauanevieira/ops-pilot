import { ChatOpenAI } from "@langchain/openai";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Single factory for the OpenRouter-backed chat model (FR-007 to FR-010). */
export function createModel() {
  return new ChatOpenAI({
    modelName: requireEnv("OPENROUTER_MODEL"),
    apiKey: requireEnv("OPENROUTER_API_KEY"),
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
    temperature: 0,
    // Some OpenRouter routes (notably rate-limited free-tier aliases) hang
    // instead of returning an error under load. Without a client-side
    // timeout a stuck call blocks the strategy forever; failing fast here
    // surfaces the problem instead of hanging the arena indefinitely.
    timeout: 60_000,
    // 010-context-measurement, R-002: `streaming: true` MUST NOT be set
    // here. In that mode ChatOpenAI computes `usage_metadata.input_tokens`
    // itself, from a local tiktoken estimate over the prompt — a number
    // that would look exactly like the provider's real reported count to
    // `inputTokensFromResult`, but isn't one. `metrics.promptTokens` is
    // documented as real precisely because this factory never streams.
  });
}
