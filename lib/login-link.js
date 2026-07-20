// 浏览器授权登录(OAuth 2.0 Device Authorization Grant 变体)。
// manturhub login(不带 --key)→ 生成链接 → 浏览器登录创建 key → 自动回传 CLI。
// key 只经后端 poll(device_code)下发,绝不进浏览器 URL。
import { spawn } from "node:child_process";
import { getBaseUrl, loadConfig, saveConfig } from "./config.js";
import { apiFetch } from "./api.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 尽力自动打开浏览器;打不开也没关系,链接已打印在终端
function openBrowser(url) {
  const p = process.platform;
  const cmd = p === "darwin" ? "open" : p === "win32" ? "cmd" : "xdg-open";
  const cmdArgs = p === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, cmdArgs, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* ignore */
  }
}

export async function loginViaBrowser() {
  const base = getBaseUrl();

  // 1. 发起 CLI 会话(无鉴权)
  let session;
  try {
    const r = await fetch(base + "/api/v1/cli/session", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    session = await r.json();
  } catch (e) {
    console.error(
      `\n  发起登录失败(${e.message})。可改用手动方式:\n    manturhub login --key sk-xxx\n`
    );
    process.exit(1);
  }
  const { device_code, user_code, verify_url, interval = 5, expires_in = 600 } = session;
  if (!device_code || !user_code || !verify_url) {
    console.error("\n  登录服务返回不完整，请稍后重试。\n");
    process.exit(1);
  }
  let verifyUrl;
  try {
    verifyUrl = new URL(verify_url);
    if (verifyUrl.origin !== new URL(base).origin) throw new Error("origin mismatch");
  } catch {
    console.error("\n  登录服务返回了不安全的授权地址，已停止。\n");
    process.exit(1);
  }

  console.log("\n  在浏览器里打开以下链接,登录后创建并授权 Key(已尝试自动打开):\n");
  console.log("    \x1b[36m" + verify_url + "\x1b[0m\n");
  console.log(
    "  核对码(请确认浏览器页面显示的码与此一致再创建): \x1b[1m" + user_code + "\x1b[0m\n"
  );
  openBrowser(verifyUrl.href);
  console.log("  等待授权中…(在网页里给这次登录起个 Key 名称并点「创建」)");

  // 2. 轮询领 key
  const deadline = Date.now() + expires_in * 1000;
  let waitSeconds = Math.max(1, Number(interval) || 5);
  while (Date.now() < deadline) {
    await sleep(waitSeconds * 1000);
    let poll;
    try {
      const r = await fetch(
        base + "/api/v1/cli/poll?device_code=" + encodeURIComponent(device_code),
        { signal: AbortSignal.timeout(15000) }
      );
      poll = await r.json();
      if (r.status === 410 || poll.status === "expired") {
        console.error("\n  授权码已过期,请重新运行 manturhub login。\n");
        process.exit(1);
      }
    } catch {
      waitSeconds = Math.min(waitSeconds * 2, 30);
      continue;
    }
    const status = poll.status || poll.error;
    if (status === "slow_down") {
      waitSeconds += 5;
      continue;
    }
    if (status === "access_denied" || status === "denied") {
      console.error("\n  已在浏览器拒绝本次授权。\n");
      process.exit(1);
    }
    if (poll.status === "ready" && poll.key) {
      const cfg = loadConfig();
      cfg.key = poll.key;
      saveConfig(cfg);
      const me = await apiFetch("/api/v1/me", { key: poll.key });
      if (me.ok) {
        const balance = Number(me.json.balance);
        const usd = Number.isFinite(balance) ? `$${(balance * 0.01).toFixed(2)} USD` : "-";
        console.log(
          `\n  ✓ 授权成功,Key 已导入 ~/.manturhub/config.json。账号: ${
            me.json.email || "-"
          }   余额: ${usd}（${me.json.balance ?? "-"} 馒头）\n`
        );
      } else {
        console.log(
          `\n  ✓ Key 已导入,但验证返回 HTTP ${me.status}(稍后可用 manturhub balance 再确认)。\n`
        );
      }
      return;
    }
    // pending → 继续等
  }
  console.error("\n  等待超时(未在时限内完成授权)。请重新运行 manturhub login。\n");
  process.exit(1);
}
