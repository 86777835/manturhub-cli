import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { extractZipSafely, validateArchiveEntries, validateSlug } from "../lib/archive.js";

test("slug validation rejects path traversal", () => {
  assert.equal(validateSlug("novel-drama_team.1"), "novel-drama_team.1");
  assert.throws(() => validateSlug("../../escape"), /格式不合法/);
  assert.throws(() => validateSlug("folder/skill"), /格式不合法/);
});

test("archive entry validation rejects absolute and parent paths", () => {
  assert.doesNotThrow(() => validateArchiveEntries(["SKILL.md", "refs/guide.md"]));
  assert.throws(() => validateArchiveEntries(["../outside"]), /不安全路径/);
  assert.throws(() => validateArchiveEntries(["/tmp/outside"]), /不安全路径/);
  assert.throws(() => validateArchiveEntries(["C:\\tmp\\outside"]), /不安全路径/);
});

test("archive entry validation rejects links and excessive file counts", () => {
  assert.throws(
    () => validateArchiveEntries(["link"], "lrwxr-xr-x  0 user group 0 link -> /tmp/outside"),
    /符号链接或硬链接/
  );
  assert.throws(
    () => validateArchiveEntries(Array.from({ length: 20001 }, (_, index) => `f${index}`)),
    /文件过多/
  );
  assert.throws(
    () => validateArchiveEntries(["large.bin"], "", 500 * 1024 * 1024 + 1),
    /解压后过大/
  );
  assert.throws(() => validateArchiveEntries(["bad\nname"]), /不安全路径/);
});

test("safe extraction verifies archive metadata before copying files", () => {
  const dir = mkdtempSync(join(tmpdir(), "manturhub-archive-test-"));
  const source = join(dir, "source");
  const dest = join(dir, "dest");
  const zip = join(dir, "package.zip");
  try {
    mkdirSync(join(source, "refs"), { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "skill");
    writeFileSync(join(source, "refs", "guide.md"), "guide");
    execFileSync("zip", ["-q", "-r", zip, "."], { cwd: source });
    extractZipSafely(zip, dest);
    assert.equal(readFileSync(join(dest, "SKILL.md"), "utf8"), "skill");
    assert.equal(readFileSync(join(dest, "refs", "guide.md"), "utf8"), "guide");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
