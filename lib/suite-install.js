import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { getKey, getBaseUrl } from "./config.js";
import { extractZipSafely, validateSlug } from "./archive.js";
import { apiFetch } from "./api.js";
import { assertSecureDownloadUrl, downloadResponseToFile } from "./download.js";

// #456 Agent 套件（团队版 Skill）：与 skill 共用 /api/v1/skills 元数据与下载端点，
// 区别在安装形态——解压为当前目录下的工作目录（非用户级 skills）。API Key 继续由
// CLI 从 ~/.manturhub/config.json 读取，绝不复制进可能被提交的项目目录。

// `manturhub suite ls` — 列出平台上线套件（kind=suite）。
export async function suiteLs({ json = false } = {}) {
  let res;
  try {
    res = await apiFetch("/api/v1/skills", { auth: "optional" });
  } catch (e) {
    console.error(`套件列表获取失败: ${e.message}`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`套件列表获取失败（HTTP ${res.status}）`);
    process.exit(1);
  }
  const data = res.json;
  const suites = (data.skills || []).filter((s) => s.kind === "suite");
  if (json) {
    console.log(JSON.stringify({ suites }, null, 2));
    return;
  }
  if (!suites.length) {
    console.log(`暂无上线套件。网页版: ${getBaseUrl()}/skill?tab=suites`);
    return;
  }
  console.log(`ManturHub Agent 套件（${suites.length} 个）:\n`);
  for (const s of suites) {
    const meta = s.suite_meta || {};
    const roles = (meta.roles || []).map((r) => r.title).join("/");
    console.log(`  ${String(s.slug || "").padEnd(22)} ${s.name || ""}${roles ? `   [${roles}]` : ""}`);
    if (meta.cost_note) console.log(`  ${"".padEnd(22)} ${meta.cost_note}`);
  }
  console.log(`\n用 \`manturhub suite install <slug>\` 安装为工作目录，任意 Agent 打开即可开工。`);
}

// `manturhub suite install <slug> [目录]` — 下载套件包并安全解压为工作目录。
export async function suiteInstall(slug, dirArg) {
  if (!slug) {
    console.error("用法: manturhub suite install <slug> [目录]   （先 `manturhub suite ls` 看可用套件）");
    process.exit(1);
  }
  try {
    validateSlug(slug, "套件 ID");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const key = getKey();
  if (!key) {
    console.error("下载套件需 API Key。运行 `manturhub login`，或设置环境变量 MANTURHUB_KEY。");
    process.exit(1);
  }

  const url = `${getBaseUrl()}/api/v1/skills/${encodeURIComponent(slug)}/download`;
  // 手动处理 302：跟随预签名地址时不把 API Key 带去对象存储（同 skill add）。
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
    console.error(`套件不存在: ${slug}（用 \`manturhub suite ls\` 看可用列表）`);
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
  const dest = resolve(dirArg || `./${slug}`);
  const tempDir = mkdtempSync(join(tmpdir(), "manturhub-suite-"));
  const tmp = join(tempDir, `${slug}.zip`);
  try {
    await downloadResponseToFile(packageResponse, tmp);
    extractZipSafely(tmp, dest);
  } catch (error) {
    console.error(`安装失败: ${error.message}`);
    rmSync(tempDir, { recursive: true, force: true });
    process.exit(1);
  }
  rmSync(tempDir, { recursive: true, force: true });

  console.log(`✓ 已安装套件「${slug}」→ ${dest}`);
  console.log("  API Key 继续安全保存在 ~/.manturhub/config.json，未复制到项目目录");
  console.log(`\n下一步：用你的 Agent（Claude Code / Codex / Cursor…）打开该目录，直接说需求即可开工：`);
  console.log(`  cd ${dest}`);
}
