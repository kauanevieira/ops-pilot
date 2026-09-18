export type TraceEvent =
  | { type: "thought"; content: string }
  | { type: "action"; tool: string; args: Record<string, unknown> }
  | { type: "observation"; content: string; tool?: string; isError?: boolean }
  | { type: "plan"; steps: string[]; revision: number }
  | { type: "critique"; content: string }
  | { type: "answer"; content: string };

export interface RunMetrics {
  llmCalls: number;
  latencyMs: number;
}

export type StoppedReason = "completed" | "max-iterations" | "max-steps";

export interface StrategyResult {
  answer: string;
  trace: TraceEvent[];
  metrics: RunMetrics;
  stoppedReason: StoppedReason;
}
