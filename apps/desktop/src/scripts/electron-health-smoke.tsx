import { renderToStaticMarkup } from "react-dom/server";
import { BackendHealth } from "../renderer/ui/App.js";

const readyMarkup = renderToStaticMarkup(
  <BackendHealth
    state={{
      status: "ready",
      health: {
        status: "ok",
        app: "music-os-backend",
        database: {
          connected: true,
          path: "/tmp/music-os.sqlite"
        },
        playback: {
          mpvPath: "mpv"
        },
        checkedAt: "2026-06-08T00:00:00.000Z"
      }
    }}
  />
);
const loadingMarkup = renderToStaticMarkup(<BackendHealth state={{ status: "loading" }} />);
const errorMarkup = renderToStaticMarkup(<BackendHealth state={{ status: "error", message: "offline" }} />);

assert(readyMarkup.includes("Backend ok"), `ready health markup should include status, got ${readyMarkup}`);
assert(readyMarkup.includes("/tmp/music-os.sqlite"), `ready health markup should include database path, got ${readyMarkup}`);
assert(readyMarkup.includes("health ready"), `ready health markup should use ready class, got ${readyMarkup}`);
assert(loadingMarkup.includes("Backend checking"), `loading markup should include checking text, got ${loadingMarkup}`);
assert(errorMarkup.includes("Backend offline"), `error markup should include offline text, got ${errorMarkup}`);

console.log(JSON.stringify({ ok: true, readyMarkup }, null, 2));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
