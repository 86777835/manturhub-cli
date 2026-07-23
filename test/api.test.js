import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { apiFetch, retainBilling } from "../lib/api.js";
import { getBaseUrl } from "../lib/config.js";

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const previous = process.env.MANTURHUB_BASE;
  process.env.MANTURHUB_BASE = `http://127.0.0.1:${address.port}`;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.MANTURHUB_BASE;
    else process.env.MANTURHUB_BASE = previous;
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
  }
}

test("optional auth permits public requests without an API key", async () => {
  await withServer(
    (req, res) => {
      assert.equal(req.headers["x-api-key"], undefined);
      res.setHeader("content-type", "application/json");
      res.end('{"ok":true}');
    },
    async () => {
      const result = await apiFetch("/public", { auth: "optional", key: null });
      assert.equal(result.ok, true);
      assert.deepEqual(result.json, { ok: true });
    }
  );
});

test("required auth fails before making a request", async () => {
  await assert.rejects(() => apiFetch("/private", { key: null }), /未配置 API Key/);
});

test("async polling preserves submit billing until final settlement arrives", () => {
  const submitBilling = {
    estimated_dumplings: 120,
    charged_dumplings: 120,
    refunded_dumplings: 0,
    final: false,
  };
  assert.deepEqual(retainBilling({ status: "done" }, submitBilling), {
    status: "done",
    _billing: submitBilling,
  });

  const finalBilling = { ...submitBilling, final: true };
  assert.deepEqual(
    retainBilling({ status: "done", _billing: finalBilling }, submitBilling),
    { status: "done", _billing: finalBilling }
  );
});

test("optional GET retries anonymously when a saved key is expired", async () => {
  let calls = 0;
  await withServer(
    (req, res) => {
      calls++;
      if (req.headers["x-api-key"]) {
        jsonResponse(res, 401, { error: "UNAUTHENTICATED" });
      } else {
        jsonResponse(res, 200, { public: true });
      }
    },
    async () => {
      const result = await apiFetch("/public", { auth: "optional", key: "expired" });
      assert.equal(result.ok, true);
      assert.deepEqual(result.json, { public: true });
      assert.equal(calls, 2);
    }
  );
});

test("safe GET requests retry one transient upstream failure", async () => {
  let calls = 0;
  await withServer(
    (_req, res) => {
      calls++;
      jsonResponse(res, calls === 1 ? 503 : 200, { calls });
    },
    async () => {
      const result = await apiFetch("/flaky", { auth: "optional", key: null });
      assert.equal(result.ok, true);
      assert.deepEqual(result.json, { calls: 2 });
    }
  );
});

test("API client refuses to send credentials to another origin", async () => {
  await withServer((_req, res) => res.end("{}"), async () => {
    await assert.rejects(
      () => apiFetch("https://example.com/private", { key: "test" }),
      /拒绝向 ManturHub 之外/
    );
  });
});

test("API requests honor timeoutMs", async () => {
  await withServer(() => {}, async () => {
    await assert.rejects(
      () => apiFetch("/slow", { auth: "optional", key: null, timeoutMs: 20 }),
      /aborted|timeout/i
    );
  });
});

test("remote API base requires HTTPS while loopback HTTP remains available for development", () => {
  const previous = process.env.MANTURHUB_BASE;
  try {
    process.env.MANTURHUB_BASE = "http://example.com";
    assert.throws(() => getBaseUrl(), /必须使用 HTTPS/);
    process.env.MANTURHUB_BASE = "http://127.0.0.1:8080/";
    assert.equal(getBaseUrl(), "http://127.0.0.1:8080");
  } finally {
    if (previous === undefined) delete process.env.MANTURHUB_BASE;
    else process.env.MANTURHUB_BASE = previous;
  }
});

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
