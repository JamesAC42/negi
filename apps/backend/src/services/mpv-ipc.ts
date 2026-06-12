import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { connect, type Socket } from "node:net";

export interface MpvIpcResponse {
  data?: unknown;
  error?: string;
  request_id?: number;
}

export type MpvIpcEvent = Record<string, unknown> & { event: string };

interface PendingRequest {
  resolve(response: MpvIpcResponse): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

const COMMAND_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Persistent connection to an mpv JSON IPC endpoint.
 *
 * Native mpv exposes a unix socket that Node can connect to directly. Windows
 * mpv launched from WSL exposes a Windows named pipe that WSL Node cannot
 * open, so a single long-lived Windows node.exe relay process bridges
 * stdin/stdout to the pipe instead of spawning one PowerShell per command.
 */
export class MpvIpcClient {
  private relay: ChildProcessWithoutNullStreams | null = null;
  private socket: Socket | null = null;
  private buffer = "";
  private requestId = 0;
  private closed = false;
  private readonly pending = new Map<number, PendingRequest>();

  private constructor(
    private readonly write: (line: string) => void,
    private readonly disposeTransport: () => void,
    private readonly onEvent: (event: MpvIpcEvent) => void
  ) {}

  static async connectWindowsPipe(pipeName: string, onEvent: (event: MpvIpcEvent) => void): Promise<MpvIpcClient> {
    const pipePath = `\\\\.\\pipe\\${pipeName}`;
    const script = `
const net = require("net");
const deadline = Date.now() + ${CONNECT_TIMEOUT_MS};
function attach(sock) {
  process.stderr.write("MPV_IPC_CONNECTED\\n");
  process.stdin.pipe(sock);
  sock.pipe(process.stdout);
  sock.on("error", () => process.exit(1));
  sock.on("close", () => process.exit(0));
}
function tryConnect() {
  const sock = net.connect(${JSON.stringify(pipePath)});
  sock.once("connect", () => attach(sock));
  sock.once("error", (error) => {
    sock.destroy();
    if (Date.now() > deadline) {
      process.stderr.write("MPV_IPC_FAILED " + error.message + "\\n");
      process.exit(1);
    }
    setTimeout(tryConnect, 150);
  });
}
tryConnect();
`;
    const relay = spawn("node.exe", ["-e", script], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    const client = new MpvIpcClient(
      (line) => {
        relay.stdin.write(line);
      },
      () => {
        relay.kill();
      },
      onEvent
    );
    client.relay = relay;
    relay.stdout.on("data", (chunk: Buffer) => client.handleData(chunk));
    relay.on("exit", () => client.handleDisconnect(new Error("mpv IPC relay exited")));
    relay.on("error", (error) => client.handleDisconnect(error));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to mpv IPC pipe")), CONNECT_TIMEOUT_MS + 1_000);
      let stderrText = "";
      relay.stderr.on("data", (chunk: Buffer) => {
        stderrText += chunk.toString("utf8");
        if (stderrText.includes("MPV_IPC_CONNECTED")) {
          clearTimeout(timer);
          resolve();
        }
      });
      relay.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`mpv IPC relay exited with code ${code ?? "unknown"} before connecting: ${stderrText.trim()}`));
      });
      relay.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    return client;
  }

  static async connectUnixSocket(socketPath: string, onEvent: (event: MpvIpcEvent) => void): Promise<MpvIpcClient> {
    const socket = await connectWithRetry(socketPath, CONNECT_TIMEOUT_MS);
    const client = new MpvIpcClient(
      (line) => {
        socket.write(line);
      },
      () => {
        socket.destroy();
      },
      onEvent
    );
    client.socket = socket;
    socket.on("data", (chunk: Buffer) => client.handleData(chunk));
    socket.on("close", () => client.handleDisconnect(new Error("mpv IPC socket closed")));
    socket.on("error", (error) => client.handleDisconnect(error));
    return client;
  }

  async command(command: unknown[]): Promise<MpvIpcResponse> {
    if (this.closed) {
      throw new Error("mpv IPC connection is closed");
    }

    const requestId = ++this.requestId;
    const payload = `${JSON.stringify({ command, request_id: requestId })}\n`;
    return new Promise<MpvIpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Timed out waiting for mpv IPC response ${requestId}`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.write(payload);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.failPending(new Error("mpv IPC connection closed"));
    this.disposeTransport();
    this.relay = null;
    this.socket = null;
  }

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        this.handleLine(line);
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    if (typeof message.request_id === "number" && this.pending.has(message.request_id)) {
      const request = this.pending.get(message.request_id)!;
      this.pending.delete(message.request_id);
      clearTimeout(request.timer);
      request.resolve(message as MpvIpcResponse);
      return;
    }

    if (typeof message.event === "string") {
      this.onEvent(message as MpvIpcEvent);
    }
  }

  private handleDisconnect(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.failPending(error);
  }

  private failPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}

async function connectWithRetry(socketPath: string, timeoutMs: number): Promise<Socket> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error = new Error("mpv IPC socket connection failed");
  while (Date.now() < deadline) {
    try {
      return await new Promise<Socket>((resolve, reject) => {
        const socket = connect(socketPath);
        socket.once("connect", () => {
          socket.removeAllListeners("error");
          resolve(socket);
        });
        socket.once("error", (error) => {
          socket.destroy();
          reject(error);
        });
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await delay(150);
    }
  }
  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
