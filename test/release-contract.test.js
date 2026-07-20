import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

test("published CLI contract uses USD and exposes no legacy transport", () => {
  const files = [join(root, "README.md"), ...sourceFiles(join(root, "bin")), ...sourceFiles(join(root, "lib"))];
  const publishedText = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(publishedText, /RMB|人民币|balance_rmb|¥|\bmcp\b/i);
  assert.match(publishedText, /\$0\.01 USD/);
  assert.equal(existsSync(join(root, "lib", "mcp.js")), false);
});
