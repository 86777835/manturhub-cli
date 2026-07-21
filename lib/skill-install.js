import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { getKey, getBaseUrl } from "./config.js";
import { extractZipSafely, validateSlug } from "./archive.js";
import { apiFetch } from "./api.js";
import { assertSecureDownloadUrl, downloadResponseToFile } from "./download.js";
import { displayClient, resolveSkillClient } from "./agent-target.js";

// `manturhub skill ls` — 列出平台上线 Skill（公开元数据，无需 key；
// 配了 key 则带上——管理员租户的 key 能看到 admin 专属 Skill）。
export async function skillLs({ json = false } = {}) {
  let res;
  try {
    res = await apiFetch("/api/v1/skills", { auth: "optional" });
  } catch (e) {
    console.error(`Skill 列表获取失败: ${e.message}`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`Skill 列表获取失败（HTTP ${res.status}）`);
    process.exit(1);
  }
  const data = res.json;
  // #456：套件（kind=suite）走 `manturhub suite ls`，这里只列常规 Skill
  const skills = (data.skills || data || []).filter((s) => s.kind !== "suite");
  if (json) {
    console.log(JSON.stringify({ skills }, null, 2));
    return;
  }
  console.log(`ManturHub 上线 Skill（${skills.length} 个）:\n`);
  for (const s of skills) {
    const slug = String(s.slug || "").padEnd(22);
    const cat = s.category ? `[${s.category}]` : "";
    const ver = s.version ? `v${s.version}` : "";
    console.log(`  ${slug} ${s.name || ""}   ${cat} ${ver}`.trimEnd());
  }
  console.log(`\n用 \`manturhub skill add <slug>\` 自动识别 Agent；也可用 \`--client\` 明确指定。`);
}

// `manturhub skill add <slug>` — 自动识别 Agent，下载并安全解压到用户级 skills 目录。
export async function skillAdd(slug, client) {
  if (!slug) {
    console.error("用法: manturhub skill add <slug>   （先 `manturhub skill ls` 看可用 Skill）");
    process.exit(1);
  }
  try {
    validateSlug(slug, "Skill ID");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  let target;
  try {
    target = await resolveSkillClient(client);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  client = target.client;
  if (target.detected) console.log(`✓ 已识别 Agent：${displayClient(client)}`);

  const key = getKey();
  if (!key) {
    console.error("下载 Skill 需 API Key。运行 `manturhub login`，或设置环境变量 MANTURHUB_KEY。");
    process.exit(1);
  }

  const url = `${getBaseUrl()}/api/v1/skills/${encodeURIComponent(slug)}/download`;
  // 手动处理 302：服务端返回预签名下载地址，跟随时不把 API Key 带去对象存储。
  let res;
  try {
    res = await fetch(url, {
      headers: { "x-api-key": key },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    console.error(`下载失败: ${e.message}`);
    process.exit(1);
  }
  if (res.status === 401) {
    console.error("API Key 无效或未授权（401）。");
    process.exit(1);
  }
  if (res.status === 404) {
    console.error(`Skill 不存在: ${slug}（用 \`manturhub skill ls\` 看可用列表）`);
    process.exit(1);
  }

  let packageResponse;
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) {
      console.error("下载重定向缺少 Location 头");
      process.exit(1);
    }
    try {
      packageResponse = await fetch(assertSecureDownloadUrl(loc), { signal: AbortSignal.timeout(120000) });
    } catch (error) {
      console.error(`安装包下载失败: ${error.message}`);
      process.exit(1);
    }
  } else if (res.ok) {
    packageResponse = res;
  } else {
    console.error(`下载失败（HTTP ${res.status}）`);
    process.exit(1);
  }
  const destinations = [];
  if (client === "claude-code" || client === "all") {
    destinations.push(join(homedir(), ".claude", "skills", slug));
  }
  if (client === "codex" || client === "all") {
    destinations.push(join(homedir(), ".agents", "skills", slug));
  }
  const tempDir = mkdtempSync(join(tmpdir(), "manturhub-skill-"));
  const tmp = join(tempDir, `${slug}.zip`);
  try {
    await downloadResponseToFile(packageResponse, tmp);
    for (const dest of destinations) {
      extractZipSafely(tmp, dest);
    }
  } catch (error) {
    console.error(`安装失败: ${error.message}`);
    rmSync(tempDir, { recursive: true, force: true });
    process.exit(1);
  }
  rmSync(tempDir, { recursive: true, force: true });
  for (const dest of destinations) console.log(`✓ 已安装 Skill「${slug}」→ ${dest}`);
  console.log("  重启对应 Agent 后，用自然语言描述任务即可使用。");
}
