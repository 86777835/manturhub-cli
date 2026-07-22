import { createInterface } from "node:readline/promises";

export function formatMantou(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number} 馒头（$${(number * 0.01).toFixed(2)} USD）` : "未知";
}

export async function confirmCharge(quote, { input = process.stdin, output = process.stderr } = {}) {
  if (quote.operator_name) output.write(`\n算子：${quote.operator_name}\n`);
  output.write(`\n⚠️  本次预计消耗：${formatMantou(quote.estimated_dumplings)}\n`);
  if (quote.formula) output.write(`计费依据：${quote.formula}\n`);
  if (Number.isFinite(Number(quote.balance))) output.write(`当前余额：${quote.balance} 馒头\n`);
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question("是否继续？[y/N] ")).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export function printBillingResult(result, output = process.stderr, operatorName = null) {
  const billing = result?._billing;
  if (!billing) return;
  const estimated = Number(billing.estimated_dumplings);
  const charged = Number(billing.charged_dumplings);
  const refunded = Number(billing.refunded_dumplings);
  if (billing.final) {
    if (operatorName) output.write(`\n算子：${operatorName}\n`);
    output.write(`\n✓ 本次实际消耗：${formatMantou(charged)}\n`);
    if (Number.isFinite(refunded) && refunded > 0) output.write(`  已退款：${formatMantou(refunded)}\n`);
    if (Number.isFinite(estimated) && estimated !== charged) output.write(`  调用前预计：${formatMantou(estimated)}\n`);
  } else {
    output.write(`\n⏳ 已预扣：${formatMantou(charged)}，任务完成后以最终结算为准\n`);
  }
}
