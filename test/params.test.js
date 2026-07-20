import assert from "node:assert/strict";
import test from "node:test";
import { parseDynamicParams, validateParams } from "../lib/params.js";

const schema = {
  fields: [
    { name: "prompt", type: "string", required: true },
    { name: "count", type: "integer", required: false },
    { name: "enabled", type: "boolean", required: false },
    { name: "tags", type: "array", required: false },
    { name: "mode", type: "string", enum: ["fast", "quality"], required: false },
  ],
};

test("dynamic flags support equals syntax and skip --no-wait", () => {
  assert.deepEqual(
    parseDynamicParams(["--prompt=hello", "--count", "2", "--no-wait"]),
    { prompt: "hello", count: "2" }
  );
});

test("dynamic flags reject missing values", () => {
  assert.throws(() => parseDynamicParams(["--prompt"]), /缺少值/);
});

test("schema validation coerces dynamic string values", () => {
  const result = validateParams(
    { prompt: "hello", count: "2", enabled: "true", tags: '["a"]' },
    schema,
    { coerceStrings: true }
  );
  assert.deepEqual(result, { prompt: "hello", count: 2, enabled: true, tags: ["a"] });
});

test("schema validation rejects unknown, missing, invalid type and enum", () => {
  assert.throws(() => validateParams({ prompt: "hello", typo: 1 }, schema), /未知参数: typo/);
  assert.throws(() => validateParams({}, schema), /缺少必填参数: prompt/);
  assert.throws(() => validateParams({ prompt: "hello", count: 1.2 }, schema), /类型错误/);
  assert.throws(() => validateParams({ prompt: "hello", mode: "slow" }, schema), /只能是/);
});

test("schema-less operators still require an object body", () => {
  assert.deepEqual(validateParams({ prompt: "hello" }, null), { prompt: "hello" });
  assert.throws(() => validateParams([], null), /JSON 对象/);
});
