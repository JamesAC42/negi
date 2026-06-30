import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { SlskdService } from "../services/slskd-service.js";

let searchCreateCalls = 0;
const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  if (request.method === "POST" && request.url === "/api/v0/searches") {
    searchCreateCalls += 1;
    if (searchCreateCalls === 1) {
      writeJson(response, 429, { message: "Only one concurrent operation is permitted. Wait until the previous request completes" });
      return;
    }
    writeJson(response, 200, { id: "retry-search" });
    return;
  }

  if (request.method === "GET" && request.url === "/api/v0/searches/retry-search?includeResponses=true") {
    writeJson(response, 200, {
      isComplete: true,
      responses: [
        {
          username: "retry-user",
          hasFreeUploadSlot: true,
          queueLength: 0,
          files: [
            {
              filename: "Retry Artist/Retry Album/01 - Retry Song.flac",
              size: 30_000_000,
              bitRate: 900_000,
              sampleRate: 44_100,
              length: 200
            }
          ]
        }
      ]
    });
    return;
  }

  writeJson(response, 404, { message: `Unhandled fake slskd route ${request.method ?? "GET"} ${request.url ?? "/"}` });
});

try {
  await listen(server);
  const address = server.address() as AddressInfo;
  const slskd = new SlskdService({
    host: "127.0.0.1",
    port: 0,
    databasePath: ":memory:",
    mpvPath: "mpv",
    slskdUrl: `http://127.0.0.1:${address.port}`,
    slskdApiKey: "fixture-key"
  });

  const search = await slskd.search("Retry Artist Retry Song", 10);
  assert(searchCreateCalls === 2, `expected one retry after fake 429, got ${searchCreateCalls} create calls`);
  assert(search.results.length === 1, `expected one search result after retry, got ${search.results.length}`);
  assert(search.results[0]?.filename === "01 - Retry Song.flac", `expected mapped filename, got ${search.results[0]?.filename}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        searchCreateCalls,
        result: {
          username: search.results[0]?.username,
          filename: search.results[0]?.filename,
          extension: search.results[0]?.extension
        }
      },
      null,
      2
    )
  );
} finally {
  await close(server);
}

function listen(serverToStart: typeof server): Promise<void> {
  return new Promise((resolve, reject) => {
    serverToStart.once("error", reject);
    serverToStart.listen(0, "127.0.0.1", () => {
      serverToStart.off("error", reject);
      resolve();
    });
  });
}

function close(serverToClose: typeof server): Promise<void> {
  return new Promise((resolve, reject) => {
    serverToClose.close((error) => (error ? reject(error) : resolve()));
  });
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
