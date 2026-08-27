import { formatMoneyMinor } from "./planning-money";
import type { PurchasePlan, PurchasePlanRow } from "./purchase-planning";

const headers = [
  "SKU",
  "Product",
  "Variant",
  "Quantity",
  "Unit Cost",
  "Line Cost",
  "Currency",
  "Recommendation",
  "Budget",
  "Lead Time Days",
  "Target Cover Days",
  "Extra Delay Days",
  "Demand Change Percent",
];

function safeText(value: string): string {
  if (/^[\t\r\n]/.test(value) || /^[=+\-@]/.test(value.trimStart())) {
    return `'${value}`;
  }
  return value;
}

function cell(value: string, neutralize = false): string {
  const content = neutralize ? safeText(value) : value;
  return `"${content.replaceAll('"', '""')}"`;
}

function isSafeNonnegativeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function rowValues(plan: PurchasePlan, row: PurchasePlanRow): string[] | null {
  if (
    !isSafeNonnegativeInteger(row.quantity) ||
    row.quantity === 0 ||
    !isSafeNonnegativeInteger(row.unitCostMinor) ||
    !isSafeNonnegativeInteger(row.lineCostMinor) ||
    row.lineCostMinor !== row.quantity * row.unitCostMinor
  ) {
    return null;
  }
  return [
    row.sku ?? "",
    row.productTitle,
    row.variantTitle,
    String(row.quantity),
    formatMoneyMinor(row.unitCostMinor, plan.currencyCode),
    formatMoneyMinor(row.lineCostMinor, plan.currencyCode),
    plan.currencyCode ?? "Unknown",
    row.reason,
    formatMoneyMinor(plan.budgetMinor, plan.currencyCode),
    String(plan.inputs.leadTimeDays),
    String(plan.inputs.targetCoverDays),
    String(plan.inputs.delayDays),
    String(plan.inputs.demandChangePercent),
  ];
}

export function purchasePlanCsv(plan: PurchasePlan): string {
  if (!plan.exportable || plan.errors.length > 0 || !plan.currencyCode) return "";
  const selected = plan.rows.filter((row) => row.quantity > 0);
  if (selected.length === 0) return "";
  const body = selected.map((row) => rowValues(plan, row));
  if (body.some((row) => row === null)) return "";
  return [headers, ...(body as string[][])]
    .map((row, rowIndex) => row.map((value, index) =>
      cell(value, rowIndex > 0 && [0, 1, 2, 6, 7].includes(index)),
    ).join(","))
    .join("\r\n");
}
