import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertSecureDownloadUrl, downloadResponseToFile } from "../lib/download.js";

test("package download streams to disk and enforces the byte limit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "manturhub-download-test-"));
  const okPath = join(dir, "ok.zip");
  const largePath = join(dir, "large.zip");
  try {
    const bytes = await downloadResponseToFile(new Response("hello"), okPath, 5);
    assert.equal(bytes, 5);
    assert.equal(readFileSync(okPath, "utf8"), "hello");
    await assert.rejects(
      () => downloadResponseToFile(new Response("too large"), largePath, 5),
      /安装包过大/
    );
    assert.equal(existsSync(largePath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("package redirects require HTTPS except on loopback", () => {
  assert.equal(assertSecureDownloadUrl("https://storage.example.com/a.zip"), "https://storage.example.com/a.zip");
  assert.equal(assertSecureDownloadUrl("http://127.0.0.1:8080/a.zip"), "http://127.0.0.1:8080/a.zip");
  assert.throws(() => assertSecureDownloadUrl("http://storage.example.com/a.zip"), /必须使用 HTTPS/);
});
