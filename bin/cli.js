#!/usr/bin/env node
import { getBaseUrl, saveConfig, loadConfig } from "../lib/config.js";
import { apiFetch, pollJob } from "../lib/api.js";
import { runInit } from "../lib/setup.js";
import { skillLs, skillAdd } from "../lib/skill-install.js";
import { suiteLs, suiteInstall } from "../lib/suite-install.js";
import { loginViaBrowser } from "../lib/login-link.js";
import { maybeNotifyUpdate } from "../lib/update-check.js";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, extname } from "node:path";
import { parseDynamicParams, validateParams } from "../lib/params.js";

// 本地文件 → MIME(presign 只接受 image/audio/video)
const MIME_BY_EXT = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".bmp": "image/bmp",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac",
  ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime",
  ".webm": "video/webm", ".mkv": "video/x-matroska",
};
function mimeFromFile(f) {
  return MIME_BY_EXT[extname(f).toLowerCase()] || null;
}

const VERSION = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")
).version;
const args = process.argv.slice(2);
const cmd = args[0];

function getFlag(name, def) {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--")
    ? args[i + 1]
    : def;
}

const hasFlag = (name) => args.includes(`--${name}`) || args.some((arg) => arg.startsWith(`--${name}=`));

function assertFlags(tokens, { value = [], boolean = [] } = {}) {
  const valueFlags = new Set(value);
  const booleanFlags = new Set(boolean);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token?.startsWith("--")) throw new Error(`无法识别的位置参数: ${token}`);
    const equals = token.indexOf("=");
    const name = token.slice(2, equals > 2 ? equals : undefined);
    if (booleanFlags.has(name)) {
      if (equals > 2) throw new Error(`选项 --${name} 不接受值`);
      continue;
    }
    if (!valueFlags.has(name)) throw new Error(`未知选项: --${name}`);
    if (equals > 2) {
      if (!token.slice(equals + 1)) throw new Error(`参数 --${name} 缺少值`);
      continue;
    }
    const next = tokens[i + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`参数 --${name} 缺少值`);
    i++;
  }
}

function assertRunControlFlags(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--no-wait" || token.startsWith("--json=") || token.startsWith("--json-file=")) continue;
    if (token === "--json" || token === "--json-file") {
      const value = tokens[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`参数 ${token} 缺少值`);
      i++;
      continue;
    }
    throw new Error(`未知选项: ${token}`);
  }
}

function usdFor(dumplings) {
  const value = Number(dumplings);
  return Number.isFinite(value) ? `$${(value * 0.01).toFixed(2)} USD` : "-";
}

const HELP = `manturhub — ManturHub 算子广场 CLI  v${VERSION}

用法:
  manturhub login                     浏览器授权登录（生成链接→登录创建 Key→自动导入，推荐）
  manturhub login --key sk-xxx        手动配置 API Key（存 ~/.manturhub/config.json）
  manturhub login --key-stdin         从 stdin 安全读取 API Key
  manturhub ls [--cat <分类>] [--json]  列出上线算子（无需登录）
  manturhub describe <算子ID> [--json]  查看算子入参字段（无需登录）
  manturhub quote <算子ID>            查询实时计费公式（不要使用 Skill 内的历史价格）
  manturhub run <算子ID> --json '{}'  调用算子（异步算子自动轮询到出结果；--no-wait 只拿 job_id）
  manturhub run <算子ID> --json-file x.json  从文件读参数（prompt 来自配方/用户时更安全）
  manturhub upload <本地文件>         上传图片/音频/视频 → 公网 URL（喂算子前先转换本地文件）
  manturhub status <poll_url>         查异步任务状态（配合 run --no-wait）
  manturhub balance                   查询馒头余额
  manturhub init                      装「ManturHub 使用 skill」+ 写 agent 引导（推荐：让 agent 会用算子）
  manturhub skill ls                  列出平台 Skill（业务成品流程，如爆款复刻）
  manturhub skill add <slug> [--client claude-code|codex|all]
                                      自动识别 Agent 并安装 Skill（可显式指定）
  manturhub suite ls                  列出 Agent 套件（多角色团队工作区，给 Agent 配一整个团队）
  manturhub suite install <slug>      安装套件为工作目录 ./<slug>/（不复制 API Key）
  manturhub recipe [关键词] [--cat x] 搜配方（已验证创作的效果+可复现参数；分类 video/image/script）
  manturhub recipe get <配方ID>       看配方提示词模板与调用参数（换掉 {占位符} 即可复刻）
  manturhub help | --version

环境变量:
  MANTURHUB_KEY    API Key（优先于配置文件）
  MANTURHUB_BASE   网关地址（默认 ${getBaseUrl()}）

推荐接入（CLI + Skill）:
  npm i -g @manturhub/cli
  manturhub login
  manturhub init                       # 装使用 skill + 写引导，之后 agent 直接用 manturhub run/ls/upload 调算子
`;

async function main() {
  maybeNotifyUpdate(VERSION);
  if (cmd && !["help", "--help", "-h"].includes(cmd) && args.slice(1).some((arg) => arg === "--help" || arg === "-h")) {
    console.log(HELP);
    return;
  }
  switch (cmd) {
    case "login": {
      try {
        assertFlags(args.slice(1), { value: ["key"], boolean: ["key-stdin"] });
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
      if ((hasFlag("key") && !getFlag("key")) || (hasFlag("key-stdin") && getFlag("key-stdin"))) {
        console.error("用法: manturhub login --key sk-xxx   或   manturhub login --key-stdin");
        process.exit(1);
      }
      const keyFromFlag = getFlag("key");
      const useKeyStdin = hasFlag("key-stdin");
      const keyFromStdin = useKeyStdin ? readFileSync(0, "utf8").trim() : null;
      if (useKeyStdin && !keyFromStdin) {
        console.error("stdin 中没有 API Key");
        process.exit(1);
      }
      if (keyFromFlag && keyFromStdin) {
        console.error("--key 和 --key-stdin 只能使用一个");
        process.exit(1);
      }
      const key = keyFromFlag || keyFromStdin;
      if (!key) {
        // 无 --key → 浏览器授权流:生成链接,登录创建 key 后自动导入
        await loginViaBrowser();
        break;
      }
      const r = await apiFetch("/api/v1/me", { key });
      if (r.ok) {
        const cfg = loadConfig();
        cfg.key = key;
        saveConfig(cfg);
        console.log(
          `✓ Key 已验证并保存。账号: ${r.json.email || "-"}   余额: ${usdFor(r.json.balance)}（${r.json.balance ?? "-"} 馒头）`
        );
      } else {
        console.error(`Key 验证失败（HTTP ${r.status}），未修改本地配置。请确认 key 是否正确、是否已激活。`);
        process.exit(1);
      }
      break;
    }

    case "init": {
      runInit();
      break;
    }

    case "ls": {
      try {
        assertFlags(args.slice(1), { value: ["cat"], boolean: ["json"] });
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
      const cat = getFlag("cat");
      const cats = new Set(["text", "image", "video", "audio", "data"]);
      if (cat && !cats.has(cat)) {
        console.error(`未知分类: ${cat}（可选: ${[...cats].join(" | ")}）`);
        process.exit(1);
      }
      const r = await apiFetch("/api/v1/operators?status=online", { auth: "optional" });
      if (!r.ok) {
        console.error(`列表获取失败（HTTP ${r.status}）`);
        process.exit(1);
      }
      let ops = r.json.operators || r.json || [];
      if (cat) ops = ops.filter((o) => o.cat === cat);
      if (hasFlag("json")) {
        console.log(JSON.stringify({ operators: ops }, null, 2));
        break;
      }
      console.log(`ManturHub 上线算子（${ops.length} 个）:\n`);
      for (const o of ops) {
        console.log(`  ${o.id.padEnd(26)} ${o.name}   [${o.cat}]`);
      }
      console.log(`\n用 \`manturhub describe <算子ID>\` 查入参，\`manturhub run <算子ID> --json '{...}'\` 调用`);
      break;
    }

    case "describe":
    case "show": {
      const op = args[1];
      if (!op || op.startsWith("--")) {
        console.error("用法: manturhub describe <算子ID>   (查看入参字段)");
        process.exit(1);
      }
      try {
        assertFlags(args.slice(2), { boolean: ["json"] });
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
      const r = await apiFetch(`/api/v1/operators/${encodeURIComponent(op)}`, { auth: "optional" });
      if (!r.ok) {
        console.error(`获取失败（HTTP ${r.status}）: ${op}`);
        process.exit(1);
      }
      const o = r.json.operator || r.json;
      if (hasFlag("json")) {
        console.log(JSON.stringify(o, null, 2));
        break;
      }
      console.log(`\n${o.id}  ${o.name || ""}   [${o.cat || "-"}] · ${o.status || "-"}`);
      if (o.description) console.log(o.description);
      const ps = o.params_schema || (o.meta && o.meta.params_schema);
      if (ps && Array.isArray(ps.fields) && ps.fields.length) {
        console.log(`\n入参:`);
        for (const f of ps.fields) {
          const req = f.required ? "必填" : "可选";
          const en = f.enum ? ` {${f.enum.join("|")}}` : "";
          console.log(`  ${String(f.name).padEnd(14)} ${String(f.type || "").padEnd(7)} ${req}${en}  ${f.desc || ""}`);
        }
        if (ps.async) console.log(`\n异步算子：run 默认自动轮询到出结果（--no-wait 只拿 task_id）`);
      } else {
        console.log(`\n（该算子未声明入参 schema，详见 ${getBaseUrl()}/marketplace/${o.id}）`);
      }
      console.log(`\n调用: manturhub run ${o.id} --json '{...}'`);
      break;
    }

    case "quote": {
      const op = args[1];
      if (!op || op.startsWith("--")) {
        console.error("用法: manturhub quote <算子ID>");
        process.exit(1);
      }
      try {
        assertFlags(args.slice(2), { boolean: ["json"] });
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
      const r = await apiFetch(`/api/v1/operators/${encodeURIComponent(op)}/quote`, { auth: "optional" });
      if (!r.ok) {
        console.error(`查询价格失败（HTTP ${r.status}）: ${JSON.stringify(r.json)}`);
        process.exit(1);
      }
      if (args.includes("--json")) {
        const floor = Number(r.json.floor);
        console.log(
          JSON.stringify(
            Number.isFinite(floor) ? { ...r.json, floor_usd: floor * 0.01 } : r.json,
            null,
            2
          )
        );
      } else {
        console.log(`${r.json.operatorId || op}: ${r.json.formula || "详见算子页"}`);
        if (r.json.floor !== undefined) console.log(`最低扣费: ${usdFor(r.json.floor)}（${r.json.floor} 馒头）`);
      }
      break;
    }

    case "run": {
      const op = args[1];
      if (!op || op.startsWith("--")) {
        console.error("用法: manturhub run <算子ID> --json '{...}'   或   --字段 值");
        process.exit(1);
      }
      let body = {};
      const jsonArg = getFlag("json");
      const jsonFile = getFlag("json-file");
      if ((hasFlag("json") && !jsonArg) || (hasFlag("json-file") && !jsonFile)) {
        console.error("--json / --json-file 需要非空值");
        process.exit(1);
      }
      if (jsonArg && jsonFile) {
        console.error("--json 和 --json-file 只能使用一个");
        process.exit(1);
      }
      if (jsonArg || jsonFile) {
        try {
          assertRunControlFlags(args.slice(2));
        } catch (error) {
          console.error(error.message);
          process.exit(1);
        }
      }
      if (jsonFile) {
        try {
          body = JSON.parse(readFileSync(jsonFile, "utf8"));
        } catch (e) {
          console.error(`--json-file 读取失败或不是合法 JSON：${e.message}`);
          process.exit(1);
        }
      } else if (jsonArg) {
        try {
          body = JSON.parse(jsonArg);
        } catch {
          console.error("--json 参数不是合法 JSON");
          process.exit(1);
        }
      } else {
        try {
          body = parseDynamicParams(args.slice(2));
        } catch (error) {
          console.error(error.message);
          process.exit(1);
        }
      }
      const detail = await apiFetch(`/api/v1/operators/${encodeURIComponent(op)}`, { auth: "optional" });
      if (!detail.ok) {
        console.error(`参数校验前无法读取算子 schema（HTTP ${detail.status}），已停止调用避免误扣费`);
        process.exit(1);
      }
      const operator = detail.json.operator || detail.json;
      const schema = operator.params_schema || operator.meta?.params_schema;
      try {
        body = validateParams(body, schema, { coerceStrings: !jsonArg && !jsonFile });
      } catch (error) {
        console.error(`参数校验失败: ${error.message}`);
        process.exit(1);
      }
      const r = await apiFetch(
        `/api/v1/operators/${encodeURIComponent(op)}/invoke`,
        { method: "POST", body, timeoutMs: 120000 }
      );
      // 异步算子(返回 poll_url)默认自动轮询到出结果;--no-wait 只拿 job_id。
      const pollUrl = r.ok && r.json && r.json.poll_url;
      if (pollUrl && !args.includes("--no-wait")) {
        process.stderr.write(
          `⏳ 异步任务 ${r.json.job_id || ""} 已提交，轮询结果中（预计 ${r.json.estimated_seconds || "?"}s；加 --no-wait 可只拿 job_id）…\n`
        );
        const final = await pollJob(pollUrl, {
          onTick: (j) =>
            process.stderr.write(
              `   ${j.status || "?"}${j.elapsed_ms ? " " + Math.round(j.elapsed_ms / 1000) + "s" : ""}\n`
            ),
        });
        console.log(JSON.stringify(final, null, 2));
        const st = final && final.status;
        if (st === "failed" || st === "error" || (final && final._timeout)) process.exit(1);
      } else {
        console.log(JSON.stringify(r.json, null, 2));
        if (!r.ok) process.exit(1);
      }
      break;
    }

    case "upload": {
      const file = args[1];
      if (!file || file.startsWith("--")) {
        console.error("用法: manturhub upload <本地文件>   (图片/音频/视频 → 公网 URL)");
        process.exit(1);
      }
      try {
        assertFlags(args.slice(2));
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
      const mime = mimeFromFile(file);
      if (!mime) {
        console.error(
          `不支持的文件类型: ${file}\n仅支持图片/音频/视频（png/jpg/webp/gif/mp3/wav/m4a/mp4/mov/webm…）`
        );
        process.exit(1);
      }
      let stat;
      try {
        stat = statSync(file);
        if (!stat.isFile()) throw new Error("不是普通文件");
      } catch (e) {
        console.error(`读不到文件: ${file}（${e.message}）`);
        process.exit(1);
      }
      const p = await apiFetch("/api/v1/uploads/presign", {
        method: "POST",
        body: { filename: basename(file), size: stat.size, mime },
      });
      if (!p.ok || !p.json || !p.json.put_url) {
        console.error(`presign 失败（HTTP ${p.status}）: ${JSON.stringify(p.json)}`);
        process.exit(1);
      }
      const put = await fetch(p.json.put_url, {
        method: "PUT",
        headers: { "Content-Type": mime, "Content-Length": String(stat.size) },
        body: createReadStream(file),
        duplex: "half",
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      if (!put.ok) {
        console.error(`上传到存储失败（HTTP ${put.status}）`);
        process.exit(1);
      }
      console.log(p.json.access_url); // 公网 URL，直接喂给算子
      break;
    }

    case "status": {
      const pu = args[1];
      if (!pu || pu.startsWith("--")) {
        console.error("用法: manturhub status <poll_url>   (poll_url 来自 run --no-wait 的返回)");
        process.exit(1);
      }
      try {
        assertFlags(args.slice(2));
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
      const r = await apiFetch(pu);
      console.log(JSON.stringify(r.json, null, 2));
      if (!r.ok) process.exit(1);
      break;
    }

    case "balance": {
      try {
        assertFlags(args.slice(1), { boolean: ["json"] });
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
      const r = await apiFetch("/api/v1/me");
      if (!r.ok) {
        console.error(`查询失败（HTTP ${r.status}）`);
        process.exit(1);
      }
      console.log(
        hasFlag("json")
          ? JSON.stringify({ ...r.json, balance_usd: Number(r.json.balance) * 0.01 }, null, 2)
          : `余额: ${usdFor(r.json.balance)}（${r.json.balance ?? "-"} 馒头）   账号: ${r.json.email || "-"}`
      );
      break;
    }

    case "skill": {
      const sub = args[1];
      if (sub === "ls" || sub === "list") {
        try {
          assertFlags(args.slice(2), { boolean: ["json"] });
        } catch (error) {
          console.error(error.message);
          process.exit(1);
        }
        await skillLs({ json: hasFlag("json") });
      } else if (sub === "add" || sub === "install") {
        try {
          assertFlags(args.slice(3), { value: ["client"] });
        } catch (error) {
          console.error(error.message);
          process.exit(1);
        }
        await skillAdd(args[2], getFlag("client"));
      }
      else {
        console.error("用法: manturhub skill ls   |   manturhub skill add <slug> [--client claude-code|codex|all]");
        process.exit(1);
      }
      break;
    }

    case "suite":
    case "suites": {
      const sub = args[1];
      if (sub === "ls" || sub === "list" || sub === undefined) {
        try {
          assertFlags(args.slice(sub === undefined ? 1 : 2), { boolean: ["json"] });
        } catch (error) {
          console.error(error.message);
          process.exit(1);
        }
        await suiteLs({ json: hasFlag("json") });
      }
      else if (sub === "install" || sub === "add") {
        if (args.length > 4 || args[3]?.startsWith("--")) {
          console.error("用法: manturhub suite install <slug> [目录]");
          process.exit(1);
        }
        await suiteInstall(args[2], args[3]);
      }
      else {
        console.error("用法: manturhub suite ls   |   manturhub suite install <slug> [目录]");
        process.exit(1);
      }
      break;
    }

    case "recipe":
    case "recipes": {
      const sub = args[1];
      if (sub === "get" || sub === "show") {
        const slug = args[2];
        if (!slug || slug.startsWith("--")) {
          console.error("用法: manturhub recipe get <配方ID>");
          process.exit(1);
        }
        try {
          assertFlags(args.slice(3), { boolean: ["json"] });
        } catch (error) {
          console.error(error.message);
          process.exit(1);
        }
        const r = await apiFetch(`/api/v1/recipes/${encodeURIComponent(slug)}`, { auth: "optional" });
        if (!r.ok) {
          console.error(`获取失败（HTTP ${r.status}）: ${slug}`);
          process.exit(1);
        }
        const d = r.json;
        if (args.includes("--json")) {
          console.log(JSON.stringify(d, null, 2));
          break;
        }
        console.log(`\n${d.title}  [${d.cat}] · 复刻 ${d.cost_estimate}`);
        console.log(`${d.summary}\n`);
        if (d.sample_url) {
          const su = d.sample_url.startsWith("http")
            ? d.sample_url
            : `${getBaseUrl()}${d.sample_url}`;
          console.log(`效果样片: ${su}`);
        }
        console.log(`配方页:   ${getBaseUrl()}/recipes/${d.slug}\n`);
        if (d.prompt_template) console.log(`提示词模板:\n${d.prompt_template}\n`);
        console.log("结构化参数（把 {占位符} 换成用户内容）:");
        console.log(JSON.stringify(d.params_json || {}, null, 2));
        console.log("\n安全执行：将每步 params 写入 JSON 文件，再运行 `manturhub run <算子ID> --json-file <文件>`。");
        if (d.sample_text) console.log(`\n效果节选:\n${d.sample_text}`);
        break;
      }
      // manturhub recipe [ls|search] [关键词] [--cat video|image|script]
      const listArgs = args.slice(1);
      let cursor = ["ls", "list", "search"].includes(listArgs[0]) ? 1 : 0;
      const kwArg = listArgs[cursor] && !listArgs[cursor].startsWith("--") ? listArgs[cursor++] : "";
      const cat = getFlag("cat");
      try {
        assertFlags(listArgs.slice(cursor), { value: ["cat"], boolean: ["json"] });
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
      if (cat && !new Set(["video", "image", "script"]).has(cat)) {
        console.error(`未知配方分类: ${cat}（可选: video | image | script）`);
        process.exit(1);
      }
      const r = await apiFetch(`/api/v1/recipes${cat ? `?cat=${encodeURIComponent(cat)}` : ""}`, { auth: "optional" });
      if (!r.ok) {
        console.error(`配方列表获取失败（HTTP ${r.status}）`);
        process.exit(1);
      }
      let list = r.json.recipes || [];
      if (kwArg) {
        const k = kwArg.toLowerCase();
        list = list.filter((x) =>
          `${x.title}${x.summary}${(x.tags || []).join(",")}`.toLowerCase().includes(k)
        );
      }
      if (hasFlag("json")) {
        console.log(JSON.stringify({ recipes: list }, null, 2));
        break;
      }
      console.log(`ManturHub 配方（${list.length} 个）:\n`);
      for (const x of list) {
        console.log(`  ${x.slug.padEnd(32)} [${x.cat}] ${x.title} · 复刻 ${x.cost_estimate}`);
      }
      console.log(
        `\n用 \`manturhub recipe get <配方ID>\` 看提示词模板与调用参数；挑选体验更好的网页版: ${getBaseUrl()}/recipes`
      );
      break;
    }

    case "--version":
    case "-v":
      console.log(VERSION);
      break;

    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(HELP);
      break;

    default:
      console.error(`未知命令: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error("错误:", e.message);
  process.exit(1);
});
