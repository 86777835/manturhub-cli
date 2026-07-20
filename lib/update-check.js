import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CACHE = join(homedir(), ".manturhub", "update-check.json");
const ONE_DAY = 24 * 60 * 60 * 1000;

function isNewer(latest, current) {
  const a = String(latest).split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(current).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

// 启动时调用：读本地缓存→落后则 stderr 提示；缓存超过一天→后台异步刷新（不阻塞本次）。
// 永不抛错、永不写 stdout，避免污染命令的机器可读输出。
export function maybeNotifyUpdate(currentVersion) {
  if (process.env.MANTURHUB_DISABLE_UPDATE_CHECK === "1") return;
  try {
    let cache = {};
    if (existsSync(CACHE)) {
      try {
        cache = JSON.parse(readFileSync(CACHE, "utf8"));
      } catch {
        cache = {};
      }
    }
    if (cache.latest && isNewer(cache.latest, currentVersion)) {
      process.stderr.write(
        `\n⚠ manturhub 有新版 ${cache.latest}（当前 ${currentVersion}）。` +
          `\n  更新: npm i -g @manturhub/cli@latest\n\n`
      );
    }
    if (Date.now() - (cache.checkedAt || 0) > ONE_DAY) {
      // 短命 CLI 进程里直接 fetch 会随进程退出被中断，改 spawn 一个 detached 子进程
      // 去查 npm 并写缓存；父进程不等它（unref），下次启动读到结果再提示。
      const script = join(dirname(fileURLToPath(import.meta.url)), "update-fetch.js");
      const child = spawn(process.execPath, [script], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    }
  } catch {
    /* 检查更新绝不影响主命令 */
  }
}
