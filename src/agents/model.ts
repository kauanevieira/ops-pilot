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
  });
}
