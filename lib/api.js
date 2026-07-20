import { getKey, getBaseUrl } from "./config.js";

// Thin REST client against the ManturHub gateway. Public discovery calls may omit auth.
export async function apiFetch(
  path,
  { method = "GET", body, key, auth = "required", timeoutMs = 30000 } = {}
) {
  const apiKey = key === undefined ? getKey() : key;
  if (auth === "required" && !apiKey) {
    throw new Error(
      "未配置 API Key。运行 `manturhub login`，或设置环境变量 MANTURHUB_KEY。"
    );
  }
  const base = new URL(getBaseUrl());
  const url = new URL(path, base.href.endsWith("/") ? base.href : base.href + "/");
  if (url.origin !== base.origin) {
    throw new Error(`拒绝向 ManturHub 之外的地址发送请求: ${url.origin}`);
  }
  const request = (includeKey) =>
    fetch(url, {
      method,
      headers: {
        ...(includeKey && apiKey ? { "x-api-key": apiKey } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  const requestWithRetry = async (includeKey) => {
    const attempts = method === "GET" ? 2 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await request(includeKey);
        const retryable = [429, 502, 503, 504].includes(response.status);
        if (!retryable || attempt === attempts) return response;
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
        await response.body?.cancel();
        await new Promise((resolve) =>
          setTimeout(resolve, Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 10000) : 250)
        );
      } catch (error) {
        if (attempt === attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  };
  let res = await requestWithRetry(true);
  // An expired local key must not block public discovery. Retry only safe optional GETs.
  if (auth === "optional" && method === "GET" && apiKey && res.status === 401) {
    await res.body?.cancel();
    res = await requestWithRetry(false);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { ok: res.ok, status: res.status, json };
}

// 异步算子:轮询 invoke 返回的 poll_url 直到任务出终态(succeeded/failed/…),返回最终 json。
// 未知 shape(无 status 字段)按终态处理,直接返回让上层打印。
const ACTIVE = new Set(["queued", "running", "pending", "processing", "in_progress"]);
export async function pollJob(pollUrl, { intervalMs = 8000, maxMs = 1200000, onTick } = {}) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < maxMs) {
    const r = await apiFetch(pollUrl, { timeoutMs: 30000 });
    last = r.json;
    const s = r.json && r.json.status;
    if (onTick) onTick(r.json);
    if (!r.ok || !s || !ACTIVE.has(s)) return r.json; // 终态(或报错/未知 shape)→ 返回
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return { ...(last || {}), status: (last && last.status) || "timeout", _timeout: true };
}
