import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "bin", "cli.js");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

test("CLI supports machine discovery and validates paid calls before invoke", async () => {
  const invocations = [];
  let uploaded = "";
  let base;
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/v1/operators?status=online") {
      json(res, 200, { operators: [{ id: "demo", name: "Demo", cat: "text" }] });
      return;
    }
    if (req.method === "GET" && req.url === "/api/v1/operators/demo") {
      json(res, 200, {
        id: "demo",
        name: "Demo",
        cat: "text",
        params_schema: {
          fields: [
            { name: "prompt", type: "string", required: true },
            { name: "count", type: "integer", required: false },
          ],
        },
      });
      return;
    }
    if (req.method === "GET" && req.url === "/api/v1/me") {
      json(res, 200, { email: "test@example.com", balance: 100 });
      return;
    }
    if (req.method === "GET" && req.url === "/api/v1/skills") {
      json(res, 200, {
        skills: [
          { slug: "writing", name: "Writing", kind: "skill" },
          { slug: "team", name: "Team", kind: "suite" },
        ],
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/v1/operators/demo/quote") {
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw);
        const estimated = (body.count || 1) * 2;
        json(res, 200, {
          operator_id: "demo",
          estimated_dumplings: estimated,
          balance: 100,
          formula: `${body.count || 1} 项 × 2 馒头`,
          quote_id: "quote-test",
        });
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/v1/operators/demo/invoke") {
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        invocations.push(JSON.parse(raw));
        json(res, 200, { ok: true });
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/v1/uploads/presign") {
      json(res, 200, { put_url: `${base}/upload-target`, access_url: `${base}/public/demo.png` });
      return;
    }
    if (req.method === "PUT" && req.url === "/upload-target") {
      req.setEncoding("utf8");
      req.on("data", (chunk) => (uploaded += chunk));
      req.on("end", () => {
        res.statusCode = 200;
        res.end();
      });
      return;
    }
    json(res, 404, { error: "NOT_FOUND" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${address.port}`;
  const env = {
    ...process.env,
    MANTURHUB_BASE: base,
    MANTURHUB_KEY: "test-key",
    MANTURHUB_DISABLE_UPDATE_CHECK: "1",
  };

  try {
    const listed = await execFileAsync(process.execPath, [cli, "ls", "--json"], { env });
    assert.deepEqual(JSON.parse(listed.stdout), {
      operators: [{ id: "demo", name: "Demo", cat: "text" }],
    });
    await assert.rejects(
      () => execFileAsync(process.execPath, [cli, "ls", "--typo"], { env }),
      (error) => {
        assert.match(error.stderr, /未知选项: --typo/);
        return true;
      }
    );

    await assert.rejects(
      () => execFileAsync(process.execPath, [cli, "run", "demo", "--prompt=hello", "--count", "2"], { env }),
      (error) => {
        assert.equal(error.code, 3);
        assert.match(error.stderr, /CONFIRMATION_REQUIRED/);
        assert.match(error.stderr, /4 馒头/);
        assert.match(error.stderr, /quote-test/);
        return true;
      }
    );
    assert.equal(invocations.length, 0);

    const called = await execFileAsync(
      process.execPath,
      [cli, "run", "demo", "--prompt=hello", "--count", "2", "--confirm", "quote-test"],
      { env }
    );
    assert.deepEqual(JSON.parse(called.stdout), { ok: true });
    assert.deepEqual(invocations, [{ prompt: "hello", count: 2 }]);

    await assert.rejects(
      () => execFileAsync(process.execPath, [cli, "run", "demo", "--promt", "hello"], { env }),
      (error) => {
        assert.match(error.stderr, /未知参数: promt/);
        return true;
      }
    );
    assert.equal(invocations.length, 1);

    await assert.rejects(
      () =>
        execFileAsync(
          process.execPath,
          [cli, "run", "demo", "--json", '{"prompt":"hello"}', "--typo", "x"],
          { env }
        ),
      (error) => {
        assert.match(error.stderr, /未知选项: --typo/);
        return true;
      }
    );
    assert.equal(invocations.length, 1);

    const balance = await execFileAsync(process.execPath, [cli, "balance", "--json"], { env });
    assert.deepEqual(JSON.parse(balance.stdout), {
      email: "test@example.com",
      balance: 100,
      balance_usd: 1,
    });
    const skills = await execFileAsync(process.execPath, [cli, "skill", "ls", "--json"], { env });
    assert.deepEqual(JSON.parse(skills.stdout).skills.map((item) => item.slug), ["writing"]);
    const suites = await execFileAsync(process.execPath, [cli, "suite", "ls", "--json"], { env });
    assert.deepEqual(JSON.parse(suites.stdout).suites.map((item) => item.slug), ["team"]);

    const temp = mkdtempSync(join(tmpdir(), "manturhub-cli-test-"));
    const image = join(temp, "demo.png");
    writeFileSync(image, "streamed-upload");
    try {
      const upload = await execFileAsync(process.execPath, [cli, "upload", image], { env });
      assert.equal(upload.stdout.trim(), `${base}/public/demo.png`);
      assert.equal(uploaded, "streamed-upload");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }

    const help = await execFileAsync(process.execPath, [cli, "run", "--help"], { env });
    assert.match(help.stdout, /manturhub run/);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
  }
});
