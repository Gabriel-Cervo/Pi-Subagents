import { test, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverAgents } from "../src/discovery.ts";

test("project definitions override defaults and parse supported frontmatter", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-"));
  await mkdir(path.join(root, ".pi", "agents"), { recursive: true });
  await writeFile(path.join(root, ".pi", "agents", "implementer.md"), `---\ndescription: Local implementer\ndisplay_name: Local\ntools: read, bash\nenabled: false\n---\nLocal prompt`);
  const found = discoverAgents(root, true, new Set());
  const agent = found.agents.find((item) => item.name.toLowerCase() === "implementer");
  expect(agent?.source).toBe("project"); expect(agent?.enabled).toBe(false); expect(agent?.tools).toEqual(["read", "bash"]); expect(agent?.prompt).toBe("Local prompt");
});

test("legacy fields warn once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-")); await mkdir(path.join(root, ".pi", "agents"), { recursive: true });
  await writeFile(path.join(root, ".pi", "agents", "legacy.md"), `---\ndescription: old\ncolor: red\n---\nold`);
  const seen = new Set<string>(); const first = discoverAgents(root, true, seen); const second = discoverAgents(root, true, seen);
  expect(first.warnings.some((warning) => warning.includes("color"))).toBe(true); expect(second.warnings).toEqual([]);
});

test("lookups are case-insensitive and collisions warn deterministically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-subagents-")); await mkdir(path.join(root, ".pi", "agents"), { recursive: true });
  await writeFile(path.join(root, ".pi", "agents", "a.md"), `---\nname: REVIEWER\ndescription: first\n---\nfirst`);
  await writeFile(path.join(root, ".pi", "agents", "b.md"), `---\nname: reviewer\ndescription: second\n---\nsecond`);
  const found = discoverAgents(root, true, new Set());
  expect(found.agents.filter((item) => item.name.toLowerCase() === "reviewer")).toHaveLength(1);
  expect(found.warnings.some((warning) => warning.includes("Case-colliding"))).toBe(true);
});
