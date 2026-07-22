function typeName(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function normalizeType(type) {
  const t = String(type || "").toLowerCase();
  if (t.endsWith("[]") || t.startsWith("array")) return "array";
  if (t.includes("integer") || t === "int") return "integer";
  if (t.includes("number") || t === "float" || t === "double") return "number";
  if (t.includes("boolean") || t === "bool") return "boolean";
  if (t.includes("object") || t === "json") return "object";
  if (t.includes("string") || t === "url") return "string";
  return null;
}

function coerceValue(value, expected, name) {
  if (typeof value !== "string" || !expected || expected === "string") return value;
  if (expected === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`参数 ${name} 必须是 true 或 false`);
  }
  if (expected === "integer" || expected === "number") {
    const number = Number(value);
    if (!Number.isFinite(number) || (expected === "integer" && !Number.isInteger(number))) {
      throw new Error(`参数 ${name} 必须是${expected === "integer" ? "整数" : "数字"}`);
    }
    return number;
  }
  if (expected === "array" || expected === "object") {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`参数 ${name} 必须是合法 JSON ${expected === "array" ? "数组" : "对象"}`);
    }
  }
  return value;
}

function matchesType(value, expected) {
  if (!expected) return true;
  if (expected === "array") return Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === expected;
}

export function validateParams(body, schema, { coerceStrings = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("算子参数必须是 JSON 对象");
  }
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  if (!fields.length) return body;

  const byName = new Map(fields.map((field) => [String(field.name), field]));
  const unknown = Object.keys(body).filter((name) => !byName.has(name));
  if (unknown.length) {
    throw new Error(`未知参数: ${unknown.join(", ")}。请先运行 manturhub describe 查看精确字段`);
  }
  const missing = fields
    .filter((field) => field.required && !Object.hasOwn(body, field.name))
    .map((field) => field.name);
  if (missing.length) throw new Error(`缺少必填参数: ${missing.join(", ")}`);

  const result = { ...body };
  for (const [name, value] of Object.entries(result)) {
    const field = byName.get(name);
    const expected = normalizeType(field.type);
    const checked = coerceStrings ? coerceValue(value, expected, name) : value;
    if (!matchesType(checked, expected)) {
      throw new Error(`参数 ${name} 类型错误：需要 ${expected}，收到 ${typeName(checked)}`);
    }
    if (Array.isArray(field.enum) && !field.enum.includes(checked)) {
      throw new Error(`参数 ${name} 只能是: ${field.enum.join(" | ")}`);
    }
    result[name] = checked;
  }
  return result;
}

export function parseDynamicParams(tokens) {
  const body = {};
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--no-wait") continue;
    if (token === "--confirm") {
      if (tokens[i + 1] === undefined || tokens[i + 1].startsWith("--")) {
        throw new Error("参数 --confirm 缺少值");
      }
      i++;
      continue;
    }
    if (token?.startsWith("--confirm=")) continue;
    if (!token?.startsWith("--")) throw new Error(`无法识别的参数: ${token}`);
    const equals = token.indexOf("=");
    if (equals > 2) {
      body[token.slice(2, equals)] = token.slice(equals + 1);
      continue;
    }
    const value = tokens[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`参数 ${token} 缺少值`);
    }
    body[token.slice(2)] = value;
    i++;
  }
  return body;
}
