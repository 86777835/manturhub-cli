import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { confirmCharge, formatMantou, printBillingResult } from "../lib/billing-confirm.js";

test("formats, confirms and reports billing", async () => {
  assert.equal(formatMantou(85), "85 馒头（$0.85 USD）");
  const input = new PassThrough();
  const output = new PassThrough();
  input.end("y\n");
  assert.equal(await confirmCharge({ operator_name: "视频生成", estimated_dumplings: 85,
    formula: "17×5", balance: 100 }, { input, output }), true);

  let rendered = "";
  printBillingResult({ _billing: { estimated_dumplings: 85, charged_dumplings: 83,
    refunded_dumplings: 2, final: true } }, { write: (value) => { rendered += value; } }, "视频生成");
  assert.match(rendered, /算子：视频生成/);
  assert.match(rendered, /实际消耗.*83 馒头/);
  assert.match(rendered, /已退款.*2 馒头/);
});
