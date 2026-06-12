import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { AgentMessageResponse, AgentThreadResponse } from "@music-os/core";
import type { AgentService } from "./agent-service.js";

interface AgentThreadRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface AgentMessageRow {
  id: string;
  thread_id: string;
  role: string;
  text: string;
  response_json: string | null;
  created_at: string;
}

export class AgentThreadService {
  constructor(
    private readonly db: Database.Database,
    private readonly agent: AgentService
  ) {}

  getActiveThread(): AgentThreadResponse {
    const existing = this.db
      .prepare("SELECT * FROM agent_threads WHERE status = 'active' ORDER BY updated_at DESC, rowid DESC LIMIT 1")
      .get() as AgentThreadRow | undefined;
    const threadId = existing?.id ?? this.createThread("Agent Thread").thread.id;
    return this.getThread(threadId);
  }

  listThreads(): AgentThreadResponse["thread"][] {
    const rows = this.db
      .prepare("SELECT * FROM agent_threads ORDER BY updated_at DESC, rowid DESC LIMIT 50")
      .all() as AgentThreadRow[];
    return rows.map(mapThread);
  }

  getThread(threadId: string): AgentThreadResponse {
    const row = this.db.prepare("SELECT * FROM agent_threads WHERE id = ?").get(threadId) as AgentThreadRow | undefined;
    if (!row) {
      throw new Error(`Agent thread not found: ${threadId}`);
    }
    const messages = this.db
      .prepare("SELECT * FROM agent_messages WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(threadId) as AgentMessageRow[];
    return {
      thread: mapThread(row),
      messages: messages.map(mapMessage)
    };
  }

  createThread(title = "Agent Thread"): AgentThreadResponse {
    const id = nanoid();
    this.db
      .prepare("INSERT INTO agent_threads (id, title, status) VALUES (?, ?, 'active')")
      .run(id, title.trim() || "Agent Thread");
    return this.getThread(id);
  }

  async sendMessage(message: string, threadId?: string): Promise<AgentMessageResponse> {
    const thread = threadId ? this.getThread(threadId).thread : this.getActiveThread().thread;
    const trimmed = message.trim();
    if (!trimmed) {
      throw new Error("Agent message cannot be empty");
    }

    if (thread.title === "Agent Thread") {
      this.db
        .prepare("UPDATE agent_threads SET title = ?, updated_at = datetime('now') WHERE id = ?")
        .run(titleFromMessage(trimmed), thread.id);
    }

    this.insertMessage(thread.id, "user", trimmed, null);
    const response = {
      ...(await this.agent.handleMessage(trimmed)),
      threadId: thread.id
    };
    this.attachOperationBatchToThread(response, thread.id);
    this.insertMessage(thread.id, "agent", response.reply, response);
    this.db.prepare("UPDATE agent_threads SET updated_at = datetime('now') WHERE id = ?").run(thread.id);
    return response;
  }

  private attachOperationBatchToThread(response: AgentMessageResponse, threadId: string): void {
    if (!response.operationBatch) {
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

function mapThread(row: AgentThreadRow): AgentThreadResponse["thread"] {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMessage(row: AgentMessageRow): AgentThreadResponse["messages"][number] {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role === "user" ? "user" : "agent",
    text: row.text,
    response: row.response_json ? (JSON.parse(row.response_json) as AgentMessageResponse) : null,
    createdAt: row.created_at
  };
}

function titleFromMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 48 ? `${compact.slice(0, 45).trim()}...` : compact || "Agent Thread";
}
