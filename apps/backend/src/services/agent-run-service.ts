import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { AgentMessageResponse, AgentRunResponse } from "@music-os/core";
import type { AgentService, AgentStepRecorder } from "./agent-service.js";
import type { AgentModelProvider } from "./agent-model-provider.js";
import type { AgentMetadataTool } from "./agent-metadata-tool.js";

interface AgentRunRow {
  id: string;
  thread_id: string | null;
  status: string;
  objective: string;
  response_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface AgentStepRow {
  id: string;
  run_id: string;
  step_index: number;
  type: string;
  tool_name: string | null;
  status: string;
  summary: string;
  input_json: string | null;
  output_json: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

interface AgentThreadRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export class AgentRunService {
  constructor(
    private readonly db: Database.Database,
    private readonly agent: AgentService,
    private readonly modelProvider?: AgentModelProvider,
    private readonly metadataTool?: AgentMetadataTool
  ) {}

  listRuns(limit = 50): AgentRunResponse["run"][] {
    const rows = this.db
      .prepare("SELECT * FROM agent_runs ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(limit) as AgentRunRow[];
    return rows.map((row) => ({ ...mapRun(row), steps: [] }));
  }

  getRun(runId: string): AgentRunResponse["run"] {
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId) as AgentRunRow | undefined;
    if (!row) {
      throw new Error(`Agent run not found: ${runId}`);
    }
    const steps = this.db
      .prepare("SELECT * FROM agent_steps WHERE run_id = ? ORDER BY step_index ASC")
      .all(runId) as AgentStepRow[];
    return {
      ...mapRun(row),
      steps: steps.map(mapStep)
    };
  }

  async run(message: string, threadId?: string): Promise<AgentRunResponse["run"]> {
    const objective = message.trim();
    if (!objective) {
      throw new Error("Agent run message cannot be empty");
    }

    const thread = threadId ? this.getThread(threadId) : this.getActiveOrCreateThread();
    if (thread.title === "Agent Thread") {
      this.db
        .prepare("UPDATE agent_threads SET title = ?, updated_at = datetime('now') WHERE id = ?")
        .run(titleFromMessage(objective), thread.id);
    }
    this.insertMessage(thread.id, "user", objective, null);

    const runId = nanoid();
    this.db
      .prepare("INSERT INTO agent_runs (id, thread_id, status, objective) VALUES (?, ?, 'running', ?)")
      .run(runId, thread.id, objective);

    let stepIndex = 0;
    const recordStep: AgentStepRecorder = (step) => {
      this.insertStep(runId, stepIndex, step);
      stepIndex += 1;
    };

    try {
      const searchQueryHints: string[] = [];
      if (this.metadataTool) {
        try {
          const metadata = await this.metadataTool.lookup(objective);
          if (metadata) {
            searchQueryHints.push(...metadata.queryHints);
            recordStep({
              type: "tool",
              toolName: this.metadataTool.name,
              status: "completed",
              summary: metadata.summary,
              input: { objective },
              output: { queryHints: metadata.queryHints }
            });
          }
        } catch (error) {
          recordStep({
            type: "tool",
            toolName: this.metadataTool.name,
            status: "failed",
            summary: "Metadata lookup failed; continuing with local query planning",
            input: { objective },
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      if (this.modelProvider && this.modelProvider.name !== "local") {
        try {
          const modelPlan = await this.modelProvider.plan(objective);
          if (modelPlan) {
            searchQueryHints.push(...modelPlan.searchQueryHints);
            recordStep({
              type: "plan",
              toolName: `model:${this.modelProvider.name}`,
              status: "completed",
              summary: modelPlan.summary,
              input: { objective },
              output: { searchQueryHints }
            });
          }
        } catch (error) {
          recordStep({
            type: "plan",
            toolName: `model:${this.modelProvider.name}`,
            status: "failed",
            summary: "Hosted model planner failed; continuing with local deterministic planner",
            input: { objective },
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      const response = {
        ...(await this.agent.handleMessage(objective, { recordStep, discoveryQueryHints: searchQueryHints })),
        runId,
        threadId: thread.id
      };
      this.attachOperationBatch(response, thread.id);
      recordStep({
        type: "final",
        status: "completed",
        summary: response.reply,
        output: {
          intent: response.intent,
          operationBatchId: response.operationBatch?.id ?? null,
          discoveryResultCount: response.discoveryResults.length,
          libraryResultCount: response.results.length
        }
      });
      this.db
        .prepare(
          `UPDATE agent_runs
           SET status = 'completed', response_json = ?, updated_at = datetime('now'), completed_at = datetime('now')
           WHERE id = ?`
        )
        .run(JSON.stringify(response), runId);
      this.insertMessage(thread.id, "agent", response.reply, response);
      this.db.prepare("UPDATE agent_threads SET updated_at = datetime('now') WHERE id = ?").run(thread.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.insertStep(runId, stepIndex, {
        type: "final",
        status: "failed",
        summary: "Agent run failed",
        error: message
      });
      this.db
        .prepare(
          `UPDATE agent_runs
           SET status = 'failed', error = ?, updated_at = datetime('now'), completed_at = datetime('now')
           WHERE id = ?`
        )
        .run(message, runId);
    }

    return this.getRun(runId);
  }

  private getActiveOrCreateThread(): AgentThreadRow {
    const existing = this.db
      .prepare("SELECT * FROM agent_threads WHERE status = 'active' ORDER BY updated_at DESC, rowid DESC LIMIT 1")
      .get() as AgentThreadRow | undefined;
    if (existing) {
      return existing;
    }
    const id = nanoid();
    this.db
      .prepare("INSERT INTO agent_threads (id, title, status) VALUES (?, 'Agent Thread', 'active')")
      .run(id);
    return this.getThread(id);
  }

  private getThread(threadId: string): AgentThreadRow {
    const row = this.db.prepare("SELECT * FROM agent_threads WHERE id = ?").get(threadId) as AgentThreadRow | undefined;
    if (!row) {
      throw new Error(`Agent thread not found: ${threadId}`);
    }
    return row;
  }

  private attachOperationBatch(response: AgentMessageResponse, threadId: string | null): void {
    if (!response.operationBatch || !threadId) {
      return;
    }
    this.db
      .prepare("UPDATE operation_batches SET agent_thread_id = ? WHERE id = ? AND source = 'agent'")
      .run(threadId, response.operationBatch.id);
    response.operationBatch = {
      ...response.operationBatch,
      agentThreadId: threadId
    };
  }

  private insertStep(runId: string, stepIndex: number, step: Parameters<AgentStepRecorder>[0]): void {
    const status = step.status ?? "completed";
    this.db
      .prepare(
        `INSERT INTO agent_steps (
          id, run_id, step_index, type, tool_name, status, summary, input_json, output_json, error, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        nanoid(),
        runId,
        stepIndex,
        step.type,
        step.toolName ?? null,
        status,
        step.summary,
        step.input === undefined ? null : JSON.stringify(step.input),
        step.output === undefined ? null : JSON.stringify(step.output),
        step.error ?? null,
        status === "running" ? null : new Date().toISOString()
      );
  }

  private insertMessage(
    threadId: string,
    role: "user" | "agent",
    text: string,
    response: AgentMessageResponse | null
  ): void {
    this.db
      .prepare(
        `INSERT INTO agent_messages (id, thread_id, role, text, response_json)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(nanoid(), threadId, role, text, response == null ? null : JSON.stringify(response));
  }
}

function mapRun(row: AgentRunRow): Omit<AgentRunResponse["run"], "steps"> {
  return {
    id: row.id,
    threadId: row.thread_id,
    status: row.status === "failed" ? "failed" : row.status === "running" ? "running" : "completed",
    objective: row.objective,
    response: row.response_json ? (JSON.parse(row.response_json) as AgentMessageResponse) : null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

function mapStep(row: AgentStepRow): AgentRunResponse["run"]["steps"][number] {
  return {
    id: row.id,
    runId: row.run_id,
    stepIndex: row.step_index,
    type:
      row.type === "tool" || row.type === "decision" || row.type === "approval" || row.type === "final"
        ? row.type
        : "plan",
    toolName: row.tool_name,
    status: row.status === "failed" ? "failed" : row.status === "running" ? "running" : "completed",
    summary: row.summary,
    input: row.input_json ? JSON.parse(row.input_json) : null,
    output: row.output_json ? JSON.parse(row.output_json) : null,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

function titleFromMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 48 ? `${compact.slice(0, 45).trim()}...` : compact || "Agent Thread";
}
