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
  });
}
