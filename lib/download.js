import { createWriteStream, rmSync } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;

export function assertSecureDownloadUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("下载重定向地址不合法");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("安装包下载地址必须使用 HTTPS");
  }
  return url.href;
}

export async function downloadResponseToFile(response, target, maxBytes = MAX_PACKAGE_BYTES) {
  if (!response.ok) throw new Error(`安装包下载失败（HTTP ${response.status}）`);
  if (!response.body) throw new Error("安装包响应为空");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body.cancel();
    throw new Error(`安装包过大（最大 ${Math.floor(maxBytes / 1024 / 1024)} MB）`);
  }

  let received = 0;
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) callback(new Error(`安装包过大（最大 ${Math.floor(maxBytes / 1024 / 1024)} MB）`));
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(target, { flags: "wx" }));
    return received;
  } catch (error) {
    rmSync(target, { force: true });
    throw error;
  }
}
