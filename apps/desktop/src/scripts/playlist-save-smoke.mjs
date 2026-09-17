import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Exercise the real App save handler. Every backend request is intercepted.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-features=LocalNetworkAccessChecks"] });
const now = new Date().toISOString();
let playlist = { id: "manual-list", name: "Original list", description: "Original description", type: "manual", createdBy: "user", createdAt: now, updatedAt: now, items: [] };
let updates, failApply = false, failRefresh = false, holdApply = null, releaseApply;
const writes = [], errors = [];
const batch = (status, error = null) => ({
  id: "manual-edit", source: "user", status, summary: "Edit playlist", riskLevel: "low", agentThreadId: null,
  operations: [{ id: "edit", batchId: "manual-edit", type: "update_playlist", status, payload: updates, before: null, after: null, error }]
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://127.0.0.1:47831/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === "POST") writes.push({ path, body: request.postDataJSON() });
    if (path === "/playlists") return failRefresh
      ? route.fulfill({ status: 503, json: { message: "Refresh temporarily unavailable" } })
      : route.fulfill({ json: { playlists: [playlist] } });
    if (path === "/operations/propose-update-playlist") {
      updates = request.postDataJSON();
      return route.fulfill({ json: { batch: batch("proposed") } });
    }
    if (path === "/operations/approve-batch") return route.fulfill({ json: { batch: batch("approved") } });
    if (path === "/operations/apply-batch") {
      if (holdApply) await holdApply;
      if (failApply) return route.fulfill({ json: { batch: batch("failed", { message: "Fixture save failed" }) } });
      playlist = { ...playlist, name: updates.name, description: updates.description, updatedAt: new Date().toISOString() };
      return route.fulfill({ json: { batch: batch("applied") } });
    }
    return route.fulfill({ status: 404, json: { message: "Isolated fixture" } });
  });
  await page.goto(process.env.MUSIC_OS_RENDERER_ORIGIN ?? "http://127.0.0.1:5173");
  await page.getByRole("button", { name: "Lists", exact: true }).click();
  const workspace = page.locator(".playlistWorkspace"), form = page.locator(".playlistWorkspaceEdit");
  await workspace.getByRole("heading", { name: "Original list", exact: true }).waitFor();
  await workspace.getByRole("button", { name: "Edit", exact: true }).click();
  await form.getByLabel("Name", { exact: true }).fill("   ");
  assert.equal(await form.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
  await form.getByLabel("Name", { exact: true }).fill("  Evening listening  ");
  await form.getByLabel("Description", { exact: true }).fill("  A quieter mix  ");
  holdApply = new Promise(resolve => { releaseApply = resolve; });
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await form.getByRole("button", { name: "Saving…", exact: true }).waitFor();
  assert.equal(await form.getByRole("button", { name: "Saving…", exact: true }).isDisabled(), true);
  assert.equal(await form.getByLabel("Name", { exact: true }).isDisabled(), true);
  // Programmatic second submission is guarded too.
  await form.evaluate(node => node.requestSubmit());
  assert.equal(writes.filter(row => row.path === "/operations/propose-update-playlist").length, 1);
  releaseApply(); holdApply = null;
  await workspace.getByRole("heading", { name: "Evening listening", exact: true }).waitFor();
  await form.waitFor({ state: "hidden" });
  assert.deepEqual(writes.slice(0, 3).map(row => row.path), [
    "/operations/propose-update-playlist", "/operations/approve-batch", "/operations/apply-batch"
  ], "one Save completes the existing operation path without visiting Operations");
  assert.deepEqual(writes[0].body, { playlistId: "manual-list", name: "Evening listening", description: "A quieter mix" });
  assert.equal(await page.locator(".playlistBrowserRows button").filter({ hasText: "Evening listening" }).count(), 1);

  failApply = true;
  await workspace.getByRole("button", { name: "Edit", exact: true }).click();
  await form.getByLabel("Name", { exact: true }).fill("Retry draft");
  await form.getByLabel("Description", { exact: true }).fill("");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await workspace.getByRole("alert").filter({ hasText: "Fixture save failed" }).waitFor();
  assert.equal(await form.getByLabel("Name", { exact: true }).inputValue(), "Retry draft", "failed save preserves the draft");
  assert.equal(playlist.name, "Evening listening", "failed operation does not report a saved name");
  failApply = false;
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await workspace.getByRole("heading", { name: "Retry draft", exact: true }).waitFor();
  await form.waitFor({ state: "hidden" });
  assert.equal(playlist.description, null, "empty descriptions can be cleared");

  // A read failure after an applied edit must not invite a duplicate save.
  failRefresh = true;
  await workspace.getByRole("button", { name: "Edit", exact: true }).click();
  await form.getByLabel("Name", { exact: true }).fill("Saved despite refresh failure");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await workspace.getByRole("heading", { name: "Saved despite refresh failure", exact: true }).waitFor();
  await form.waitFor({ state: "hidden" });
  assert.equal(await workspace.getByRole("alert").count(), 0);
  assert.equal(await page.locator(".playlistsWorkbench").isVisible(), true, "save stays on the playlist page");
  await workspace.getByRole("button", { name: "Edit", exact: true }).click();
  await mkdir(".music-os", { recursive: true });
  await page.screenshot({ path: ".music-os/playlist-save.png" });
  await page.setViewportSize({ width: 900, height: 900 });
  assert.equal(await form.getByRole("button", { name: "Save", exact: true }).isVisible(), true);
  assert.deepEqual(errors, []);
  assert.equal(writes.length, 12, "four saves create only their own proposal/approval/application requests");
  console.log(JSON.stringify({ ok: true, oneClickSave: true, duplicateGuard: true, failedDraftPreserved: true, refreshFailureSafe: true, stayedOnPlaylist: true }));
} finally {
  await browser.close();
}
