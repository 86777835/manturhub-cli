import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  clientForAgentName,
  detectInstalledClients,
  normalizeClient,
  resolveSkillClient,
} from "../lib/agent-target.js";

test("explicit client always wins", async () => {
  const result = await resolveSkillClient("codex", {
    detectAgent: async () => ({ isAgent: true, agent: { name: "claude" } }),
  });
  assert.deepEqual(result, { client: "codex", detected: false });
  assert.equal(normalizeClient("claude"), "claude-code");
  assert.throws(() => normalizeClient("cursor"), /不支持的 client/);
});

test("maps running Codex and Claude environments", async () => {
  assert.equal(clientForAgentName("codex"), "codex");
  assert.equal(clientForAgentName("claude"), "claude-code");
  assert.equal(clientForAgentName("cowork"), "claude-code");
  assert.equal(clientForAgentName("cursor"), null);

  const codex = await resolveSkillClient(undefined, {
    detectAgent: async () => ({ isAgent: true, agent: { name: "codex" } }),
  });
  assert.deepEqual(codex, { client: "codex", detected: true });

  const claude = await resolveSkillClient(undefined, {
    detectAgent: async () => ({ isAgent: true, agent: { name: "claude" } }),
  });
  assert.deepEqual(claude, { client: "claude-code", detected: true });
});

test("falls back to the only installed supported Agent", async () => {
  const result = await resolveSkillClient(undefined, {
    detectAgent: async () => ({ isAgent: false }),
    installedClients: ["codex"],
  });
  assert.deepEqual(result, { client: "codex", detected: true });
});

test("detects supported Agent installations from their home directories", () => {
  const existing = new Set(["/test-home/.claude", "/test-home/.codex"]);
  assert.deepEqual(
    detectInstalledClients({ home: "/test-home", exists: (path) => existing.has(path) }),
    ["claude-code", "codex"]
  );
});

test("non-interactive ambiguous or missing detection fails clearly", async () => {
  const nonTty = { isTTY: false };
  await assert.rejects(
    resolveSkillClient(undefined, {
      detectAgent: async () => ({ isAgent: false }),
      installedClients: ["claude-code", "codex"],
      input: nonTty,
      output: nonTty,
    }),
    /--client codex/
  );
  await assert.rejects(
    resolveSkillClient(undefined, {
      detectAgent: async () => ({ isAgent: false }),
      installedClients: [],
      input: nonTty,
      output: nonTty,
    }),
    /未识别到 Codex 或 Claude Code/
  );
});

test("interactive ambiguous detection lets the user choose", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  output.isTTY = true;
  input.end("1\n");

  const result = await resolveSkillClient(undefined, {
    detectAgent: async () => ({ isAgent: false }),
    installedClients: ["claude-code", "codex"],
    input,
    output,
  });
  assert.deepEqual(result, { client: "codex", detected: false });
});
