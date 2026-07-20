import { homedir } from "node:os";
import { join } from "node:path";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from "node:fs";

// Local config lives at ~/.manturhub/config.json (chmod 600). Env vars win over it.
const DIR = join(homedir(), ".manturhub");
const FILE = join(DIR, "config.json");
// Published CLI defaults to production; test/private deployments override with
// MANTURHUB_BASE or config.json. All generated links must go through getBaseUrl().
const DEFAULT_BASE = "https://hub.mantur.ai";
const LEGACY_DEFAULT_BASES = new Set([
  "https://hub.mantur.cn",
  "https://manturhub.leisurecat.cloud",
  "https://api.ophub.com",
]);

export function loadConfig() {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

export function saveConfig(cfg) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try {
    chmodSync(FILE, 0o600);
  } catch {
    /* best-effort on platforms without chmod */
  }
}

export function getKey() {
  return process.env.MANTURHUB_KEY || loadConfig().key || null;
}

function validateBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`ManturHub 网关地址不合法: ${value}`);
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("MANTURHUB_BASE 必须使用 HTTPS（仅 localhost/127.0.0.1/::1 可使用 HTTP）");
  }
  if (url.username || url.password) throw new Error("MANTURHUB_BASE 不得包含用户名或密码");
  return url.href.replace(/\/$/, "");
}

export function getBaseUrl() {
  if (process.env.MANTURHUB_BASE) return validateBaseUrl(process.env.MANTURHUB_BASE);
  const storedBase = loadConfig().baseUrl?.replace(/\/$/, "");
  if (storedBase && !LEGACY_DEFAULT_BASES.has(storedBase)) return validateBaseUrl(storedBase);
  return DEFAULT_BASE;
}
