import { execFileSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { basename, join, posix } from "node:path";
import { tmpdir } from "node:os";

const MAX_FILES = 20000;
const MAX_UNPACKED_BYTES = 500 * 1024 * 1024;
const ARCHIVE_LIST_MAX_BUFFER = 32 * 1024 * 1024;

export function validateSlug(slug, label = "ID") {
  if (!slug || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
    throw new Error(`${label} 格式不合法: ${slug || "(空)"}`);
  }
  return slug;
}

function listArchive(zipPath) {
  const commands = [
    {
      command: "unzip",
      list: ["-Z1", zipPath],
      verbose: ["-Z", "-l", zipPath],
      summary: ["-Z", "-t", zipPath],
      extract: (dest) => ["-o", "-q", zipPath, "-d", dest],
    },
    {
      command: "tar",
      list: ["-tf", zipPath],
      verbose: ["-tvf", zipPath],
      extract: (dest) => ["-xf", zipPath, "-C", dest],
    },
  ];
  let foundExtractor = false;
  for (const tool of commands) {
    try {
      const execOptions = { encoding: "utf8", maxBuffer: ARCHIVE_LIST_MAX_BUFFER };
      const output = execFileSync(tool.command, tool.list, execOptions);
      const verbose = execFileSync(tool.command, tool.verbose, execOptions);
      const summary = tool.summary
        ? execFileSync(tool.command, tool.summary, execOptions)
        : "";
      return { tool, entries: output.split(/\r?\n/).filter(Boolean), verbose, summary };
    } catch (error) {
      if (error?.code !== "ENOENT") foundExtractor = true;
      // Missing tool or an extractor-specific parse failure: try the next one.
    }
  }
  if (foundExtractor) {
    throw new Error("解压失败：安装包格式无效、已损坏或文件清单过大");
  }
  throw new Error("解压失败（需系统 tar 或 unzip 命令）");
}

function declaredUnpackedBytes(tool, verbose, summary) {
  if (tool.command === "unzip") {
    const match = summary.match(/([\d,]+)\s+bytes? uncompressed/i);
    return match ? Number(match[1].replaceAll(",", "")) : Number.NaN;
  }
  let total = 0;
  for (const line of verbose.split(/\r?\n/).filter(Boolean)) {
    const bsd = line.match(/^\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+/);
    const gnu = line.match(/^\S+\s+\S+\s+(\d+)\s+/);
    const size = Number((bsd || gnu)?.[1]);
    if (!Number.isFinite(size)) return Number.NaN;
    total += size;
  }
  return total;
}

export function validateArchiveEntries(entries, verbose = "", unpackedBytes = 0) {
  if (!entries.length) throw new Error("安装包为空");
  if (entries.length > MAX_FILES) throw new Error(`安装包文件过多（最多 ${MAX_FILES} 个）`);
  if (!Number.isFinite(unpackedBytes) || unpackedBytes < 0) {
    throw new Error("无法确认安装包解压后大小");
  }
  if (unpackedBytes > MAX_UNPACKED_BYTES) {
    throw new Error(`安装包解压后过大（最大 ${MAX_UNPACKED_BYTES / 1024 / 1024} MB）`);
  }
  if (/^\s*[lh][rwx-]{9}\s/m.test(verbose)) {
    throw new Error("安装包不得包含符号链接或硬链接");
  }
  for (const raw of entries) {
    const name = raw.replaceAll("\\", "/");
    const normalized = posix.normalize(name);
    if (
      name.includes("\0") ||
      /[\x00-\x1f\x7f]/.test(name) ||
      name.startsWith("/") ||
      /^[a-z]:\//i.test(name) ||
      normalized === ".." ||
      normalized.startsWith("../")
    ) {
      throw new Error(`安装包包含不安全路径: ${raw}`);
    }
  }
}

function inspectExtracted(dir, state = { files: 0, bytes: 0 }) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (/[\x00-\x1f\x7f]/.test(entry.name)) {
      throw new Error(`安装包包含不安全文件名: ${JSON.stringify(entry.name)}`);
    }
    const path = join(dir, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`安装包不得包含符号链接: ${entry.name}`);
    if (stat.isDirectory()) inspectExtracted(path, state);
    else if (stat.isFile()) {
      state.files++;
      state.bytes += stat.size;
      if (state.files > MAX_FILES) throw new Error(`安装包文件过多（最多 ${MAX_FILES} 个）`);
      if (state.bytes > MAX_UNPACKED_BYTES) {
        throw new Error(`安装包解压后过大（最大 ${MAX_UNPACKED_BYTES / 1024 / 1024} MB）`);
      }
    } else {
      throw new Error(`安装包包含不支持的文件类型: ${entry.name}`);
    }
  }
  return state;
}

function rejectDestinationLinks(dir) {
  if (!lstatSync(dir).isDirectory()) throw new Error(`安装目标不是目录: ${dir}`);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`安装目标包含符号链接: ${path}`);
    if (stat.isDirectory()) rejectDestinationLinks(path);
  }
}

export function extractZipSafely(zipPath, dest) {
  const { tool, entries, verbose, summary } = listArchive(zipPath);
  validateArchiveEntries(entries, verbose, declaredUnpackedBytes(tool, verbose, summary));
  const staging = mkdtempSync(join(tmpdir(), "manturhub-extract-"));
  try {
    execFileSync(tool.command, tool.extract(staging), { stdio: ["ignore", "ignore", "ignore"] });
    inspectExtracted(staging);
    mkdirSync(dest, { recursive: true });
    rejectDestinationLinks(dest);
    for (const entry of readdirSync(staging)) {
      cpSync(join(staging, entry), join(dest, basename(entry)), { recursive: true, force: true });
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
