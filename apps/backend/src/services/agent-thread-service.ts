import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { AgentMessageResponse, AgentThreadResponse } from "@music-os/core";

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
  constructor(private readonly db: Database.Database) {}

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
