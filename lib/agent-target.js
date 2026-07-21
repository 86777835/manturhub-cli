import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { determineAgent } from "@vercel/detect-agent";

const SUPPORTED_CLIENTS = new Set(["claude", "claude-code", "codex", "all"]);

export function normalizeClient(client) {
  if (client === undefined || client === null || client === "") return null;
  if (!SUPPORTED_CLIENTS.has(client)) {
    throw new Error("不支持的 client。可用值: claude-code | codex | all");
  }
  return client === "claude" ? "claude-code" : client;
}

export function clientForAgentName(name) {
  if (name === "claude" || name === "cowork") return "claude-code";
  if (name === "codex") return "codex";
  return null;
}

export function detectInstalledClients({ home = homedir(), exists = existsSync } = {}) {
  const clients = [];
  if (exists(join(home, ".claude"))) clients.push("claude-code");
  if (exists(join(home, ".codex")) || exists("/etc/codex")) clients.push("codex");
  return clients;
}

function displayClient(client) {
  if (client === "all") return "Claude Code、Codex";
  return client === "codex" ? "Codex" : "Claude Code";
}

async function promptForClient(input, output, installedClients) {
  const detected = installedClients.length
    ? `\n检测到: ${installedClients.map(displayClient).join("、")}`
    : "";
  output.write(`${detected}\n请选择 Skill 安装目标:\n  1) Codex\n  2) Claude Code\n  3) 两者\n`);
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question("请输入 1 / 2 / 3: ")).trim();
    if (answer === "1") return "codex";
    if (answer === "2") return "claude-code";
    if (answer === "3") return "all";
    throw new Error("已取消：请输入 1、2 或 3，或使用 --client 明确指定。");
  } finally {
    rl.close();
  }
}

export async function resolveSkillClient(
  client,
  {
    detectAgent = determineAgent,
    installedClients,
    input = process.stdin,
    output = process.stdout,
  } = {}
) {
  const explicit = normalizeClient(client);
  if (explicit) return { client: explicit, detected: false };

  const agent = await detectAgent();
  const runtimeClient = agent.isAgent ? clientForAgentName(agent.agent?.name) : null;
  if (runtimeClient) return { client: runtimeClient, detected: true };

  const installed = installedClients ?? detectInstalledClients();
  if (installed.length === 1) return { client: installed[0], detected: true };

  if (input.isTTY && output.isTTY) {
    return {
      client: await promptForClient(input, output, installed),
      detected: false,
    };
  }

  if (installed.length > 1) {
    throw new Error(
      "检测到 Claude Code 和 Codex，但当前无法交互选择。请加 --client codex、--client claude-code 或 --client all。"
    );
  }
  throw new Error(
    "未识别到 Codex 或 Claude Code。请在 Agent 内重试，或加 --client codex|claude-code|all。"
  );
}

export { displayClient };
