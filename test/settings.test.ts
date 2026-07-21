import { test, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSettings } from "../src/settings.ts";

test("migrates v1 turn settings to v2 timeout settings", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-"));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-project-"));
  await mkdir(path.join(cwd, ".pi"), { recursive: true });
  await writeFile(path.join(home, "subagents.json"), JSON.stringify({ version: 1, defaultMaxTurns: 4, graceTurns: 2, runTimeoutMs: 1200, maxConcurrent: 2 }));
  const store = await loadSettings(cwd, home);
  expect(store.effective().runTimeoutMs).toBe(1200);
  const migrated = JSON.parse(await readFile(path.join(home, "subagents.json"), "utf8"));
  expect(migrated.version).toBe(2); expect(migrated.defaultMaxTurns).toBeUndefined(); expect(migrated.graceTurns).toBeUndefined();
});

test("global then project merge preserves precedence and unknown keys", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-"));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-project-"));
  await mkdir(path.join(cwd, ".pi"), { recursive: true });
  await writeFile(path.join(home, "subagents.json"), JSON.stringify({ maxConcurrent: 2, unknown: { keep: true }, agentModels: { Explore: "a/b" } }));
  await writeFile(path.join(cwd, ".pi", "subagents.json"), JSON.stringify({ joinMode: "async", agentModels: { Explore: "c/d" } }));
  const store = await loadSettings(cwd, home);
  expect(store.effective().maxConcurrent).toBe(2);
  expect(store.effective().joinMode).toBe("async");
  expect(store.effective().agentModels.Explore).toBe("c/d");
  await store.save("project", { groupTimeoutMs: 900 });
  const saved = JSON.parse(await readFile(store.projectPath, "utf8"));
  expect(saved.unknown).toBeUndefined();
  expect(saved.groupTimeoutMs).toBe(900);
  const projectModelPath = path.join(cwd, ".pi", "subagents.json");
  await store.saveModel("project", "Explore", "c/d");
  await store.saveModel("project", "Explore");
  const afterDelete = JSON.parse(await readFile(projectModelPath, "utf8"));
  expect(afterDelete.agentModels?.Explore).toBeUndefined();
  expect(store.effective().agentModels.Explore).toBe("a/b");
});
