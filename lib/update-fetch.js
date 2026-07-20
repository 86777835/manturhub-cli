// 后台短命子进程：查 npm latest 写缓存。由 update-check.js detached spawn，
// 独立于主命令运行，任何失败都静默（更新检查永不打扰用户）。
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DIR = join(homedir(), ".manturhub");
const CACHE = join(DIR, "update-check.json");

function readPrev() {
  try {
    return JSON.parse(readFileSync(CACHE, "utf8"));
  } catch {
    return {};
  }
}

try {
  const res = await fetch("https://registry.npmjs.org/@manturhub/cli/latest", {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });
  mkdirSync(DIR, { recursive: true });
  if (res.ok) {
    const j = await res.json();
    writeFileSync(CACHE, JSON.stringify({ latest: j.version, checkedAt: Date.now() }));
  } else {
    writeFileSync(CACHE, JSON.stringify({ ...readPrev(), checkedAt: Date.now() }));
  }
} catch {
  // 失败也记下时间戳（保留已知 latest），避免每次启动都重试，一天后再查。
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(CACHE, JSON.stringify({ ...readPrev(), checkedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}
