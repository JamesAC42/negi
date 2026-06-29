import type { BackendConfig } from "../config.js";

export interface AgentModelPlan {
  summary: string;
  searchQueryHints: string[];
}

export interface AgentModelProvider {
  readonly name: string;
  plan(message: string): Promise<AgentModelPlan | null>;
}

export function createAgentModelProvider(config: BackendConfig): AgentModelProvider {
  if (config.agentModelProvider === "openai" && config.openaiApiKey) {
    return new OpenAIResponsesAgentModelProvider(config.openaiApiKey, config.openaiModel ?? "gpt-5.5");
  }
  return new LocalAgentModelProvider();
}

class LocalAgentModelProvider implements AgentModelProvider {
  readonly name = "local";

  async plan(): Promise<AgentModelPlan | null> {
    return null;
  }
}

class OpenAIResponsesAgentModelProvider implements AgentModelProvider {
  readonly name = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  async plan(message: string): Promise<AgentModelPlan | null> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        reasoning: { effort: "low" },
        max_output_tokens: 800,
        instructions:
          "You plan music-library agent work for Music OS. Return compact JSON only. Never claim actions were taken. Mutating actions require local approval outside the model.",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  `User request: ${message}\n\n` +
                  "Return JSON with shape {\"summary\": string, \"searchQueryHints\": string[]}.\n" +
                  "searchQueryHints should be short Soulseek fallback searches, especially album/title/track names that avoid famous artist tokens likely to be suppressed."
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI Responses API returned ${response.status}: ${await response.text()}`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    return parsePlan(extractOutputText(body));
  }
}

function extractOutputText(body: Record<string, unknown>): string {
  const direct = body.output_text;
  if (typeof direct === "string") {
    return direct;
  }

  const output = Array.isArray(body.output) ? body.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    const record = isRecord(item) ? item : null;
    const content = Array.isArray(record?.content) ? record.content : [];
    for (const part of content) {
      const partRecord = isRecord(part) ? part : null;
      const text = partRecord?.text;
      if (typeof text === "string") {
        chunks.push(text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function parsePlan(text: string): AgentModelPlan | null {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const searchQueryHints = Array.isArray(parsed.searchQueryHints)
      ? parsed.searchQueryHints.filter((hint): hint is string => typeof hint === "string").map((hint) => hint.trim()).filter(Boolean)
      : [];
    if (!summary && searchQueryHints.length === 0) {
      return null;
    }
    return {
      summary: summary || "Model generated search hints.",
      searchQueryHints: [...new Set(searchQueryHints)].slice(0, 8)
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}
