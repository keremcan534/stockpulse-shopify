import { variantAgeDays } from "./inventory-metrics";
import type { InventoryRow } from "./inventory.types";
import { currencyDigits, parseMoneyMinor } from "./planning-money";

export interface PlanningInputs {
  budget: string;
  leadTimeDays: number;
  targetCoverDays: number;
  delayDays: number;
  demandChangePercent: number;
}

export interface PurchasePlanRow {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  need: number;
  quantity: number;
  unitCostMinor: number | null;
  lineCostMinor: number | null;
  daysOfStock: number | null;
  action: "buy" | "defer" | "check-data" | "no-purchase";
  reason: string;
}

export interface PurchasePlan {
  rows: PurchasePlanRow[];
  currencyCode: string | null;
  inputs: PlanningInputs;
  budgetMinor: number | null;
  totalCostMinor: number;
  remainingBudgetMinor: number | null;
  neededUnits: number;
  unfilledUnits: number;
  stockoutsBeforeDelivery: number;
  errors: string[];
  exportable: boolean;
}

export interface NoSalesStockSummary {
  totalCostMinor: number | null;
  currencyCode: string | null;
  qualifyingVariants: number;
  knownCostVariants: number;
  missingCostVariants: number;
  knownCostUnits: number;
  missingCostUnits: number;
  salesAvailable: boolean;
  rows: Array<{
    variantId: string;
    productTitle: string;
    variantTitle: string;
    sku: string | null;
    units: number;
    costMinor: number | null;
  }>;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const HUNDRED = 100n;
const THIRTY_DAYS = 30n;

interface Candidate {
  planRow: PurchasePlanRow;
  demand: bigint;
  stock: bigint;
}

function isWholeWithin(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isValidCount(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function safeNumber(value: bigint): number | null {
  return value >= 0n && value <= MAX_SAFE ? Number(value) : null;
}

function basePlanRow(source: InventoryRow): PurchasePlanRow {
  return {
    variantId: source.variantId,
    productTitle: source.productTitle,
    variantTitle: source.variantTitle,
    sku: source.sku,
    need: 0,
    quantity: 0,
    unitCostMinor: null,
    lineCostMinor: null,
    daysOfStock: null,
    action: "check-data",
    reason: "Planning data is unavailable.",
  };
}

function validationErrors(inputs: PlanningInputs, currencyCode: string | null): {
  errors: string[];
  budgetMinor: number | null;
} {
  const errors: string[] = [];
  const digits = currencyDigits(currencyCode);
  let budgetMinor: number | null = null;
  if (digits === null) {
    errors.push("A known shop currency is required for purchase planning.");
  } else {
    budgetMinor = parseMoneyMinor(inputs.budget, currencyCode);
    const maximum = BigInt(1_000_000_000) * 10n ** BigInt(digits);
    if (budgetMinor === null || BigInt(budgetMinor) > maximum) {
      budgetMinor = null;
      errors.push("Budget must be between 0 and 1,000,000,000 currency units.");
    }
  }
  if (!isWholeWithin(inputs.leadTimeDays, 0, 365)) {
    errors.push("Lead time must be a whole number from 0 to 365 days.");
  }
  if (!isWholeWithin(inputs.targetCoverDays, 1, 365)) {
    errors.push("Target cover must be a whole number from 1 to 365 days.");
  }
  if (!isWholeWithin(inputs.delayDays, 0, 365)) {
    errors.push("Extra delay must be a whole number from 0 to 365 days.");
  }
  if (!isWholeWithin(inputs.demandChangePercent, -100, 500)) {
    errors.push("Demand change must be a whole percentage from -100% to 500%.");
  }
  return { errors, budgetMinor };
}

function eligibilityReason(source: InventoryRow, now: Date): string | null {
  if (source.productStatus === null) return "Product status is unknown.";
  if (source.productStatus !== "ACTIVE") return "Product is not active.";
  if (!source.tracked) return "Inventory is not tracked.";
  if (source.isGiftCard === null) return "Gift-card status is unknown.";
  if (source.isGiftCard) return "Gift-card variants are not purchase candidates.";
  const age = variantAgeDays(source.createdAt, now);
  if (age === null) return "Variant age is unknown or in the future.";
  if (age < 30) return "Variant has less than 30 days of known age.";
  if (!isValidCount(source.units30Days)) return "30-day sales data is unavailable.";
  if (!Number.isSafeInteger(source.availableInventory)) {
    return "Available stock data is invalid.";
  }
  return null;
}

function costMinor(source: InventoryRow, currencyCode: string | null): number | null {
  if (!source.unitCost || source.unitCost.currencyCode !== currencyCode) return null;
  return parseMoneyMinor(source.unitCost.amount, currencyCode, true);
}

function calculateNeed(
  units30Days: number,
  stock: number,
  inputs: PlanningInputs,
): number | null {
  const demandMultiplier = BigInt(100 + inputs.demandChangePercent);
  const horizon = BigInt(inputs.leadTimeDays + inputs.delayDays + inputs.targetCoverDays);
  const denominator = THIRTY_DAYS * HUNDRED;
  const target = BigInt(units30Days) * demandMultiplier * horizon;
  const shortfall = target - BigInt(Math.max(0, stock)) * denominator;
  if (shortfall <= 0n) return 0;
  return safeNumber((shortfall + denominator - 1n) / denominator);
}

function calculatedDaysOfStock(
  units30Days: number,
  stock: number,
  demandChangePercent: number,
): number | null {
  if (units30Days <= 0 || demandChangePercent <= -100) return null;
  const numerator = BigInt(Math.max(0, stock)) * THIRTY_DAYS * HUNDRED;
  const denominator = BigInt(units30Days) * BigInt(100 + demandChangePercent);
  if (denominator <= 0n || numerator > MAX_SAFE || denominator > MAX_SAFE) return null;
  return Number(numerator) / Number(denominator);
}

function addChecked(left: number, right: number): number | null {
  const total = BigInt(left) + BigInt(right);
  return safeNumber(total);
}

function multiplyChecked(left: number, right: number): number | null {
  return safeNumber(BigInt(left) * BigInt(right));
}

export function buildPurchasePlan(
  rows: InventoryRow[],
  currencyCode: string | null,
  inputs: PlanningInputs,
  now: Date,
  edits: Record<string, string> = {},
): PurchasePlan {
  const copiedInputs = { ...inputs };
  const { errors, budgetMinor } = validationErrors(copiedInputs, currencyCode);
  const resultRows = rows.map(basePlanRow);
  if (errors.length > 0 || budgetMinor === null) {
    for (const row of resultRows) {
      row.reason = "Planning inputs are invalid.";
    }
    return {
      rows: resultRows,
      currencyCode,
      inputs: copiedInputs,
      budgetMinor,
      totalCostMinor: 0,
      remainingBudgetMinor: null,
      neededUnits: 0,
      unfilledUnits: 0,
      stockoutsBeforeDelivery: 0,
      errors,
      exportable: false,
    };
  }
  const candidates: Candidate[] = [];
  let stockoutsBeforeDelivery = 0;

  rows.forEach((source, index) => {
    const planRow = resultRows[index];
    const exclusion = eligibilityReason(source, now);
    if (exclusion) {
      planRow.reason = exclusion;
      return;
    }
    const units30Days = source.units30Days!;
    if (units30Days === 0 || copiedInputs.demandChangePercent === -100) {
      planRow.action = "no-purchase";
      planRow.reason = "No positive demand is measurable for this scenario.";
      return;
    }
    const need = calculateNeed(units30Days, source.availableInventory, copiedInputs);
    if (need === null) {
      planRow.reason = "Demand calculation exceeds safe numeric limits.";
      return;
    }
    planRow.need = need;
    planRow.daysOfStock = calculatedDaysOfStock(
      units30Days,
      source.availableInventory,
      copiedInputs.demandChangePercent,
    );
    const beforeDelivery = BigInt(Math.max(0, source.availableInventory)) * THIRTY_DAYS * HUNDRED <
      BigInt(units30Days) * BigInt(100 + copiedInputs.demandChangePercent) *
        BigInt(copiedInputs.leadTimeDays + copiedInputs.delayDays);
    if (beforeDelivery) stockoutsBeforeDelivery += 1;
    if (need === 0) {
      planRow.action = "no-purchase";
      planRow.reason = "Current stock covers the selected lead time and target cover.";
      return;
    }
    const unitCostMinor = costMinor(source, currencyCode);
    if (unitCostMinor === null) {
      planRow.reason = "Unit cost is missing, invalid, or does not match the shop currency.";
      return;
    }
    planRow.unitCostMinor = unitCostMinor;
    candidates.push({
      planRow,
      demand: BigInt(units30Days) * BigInt(100 + copiedInputs.demandChangePercent),
      stock: BigInt(Math.max(0, source.availableInventory)),
    });
  });

  if (errors.length === 0 && budgetMinor !== null) {
    let remaining = budgetMinor;
    const ordered = [...candidates].sort((left, right) => {
      const leftDays = left.stock * THIRTY_DAYS * HUNDRED * right.demand;
      const rightDays = right.stock * THIRTY_DAYS * HUNDRED * left.demand;
      if (leftDays < rightDays) return -1;
      if (leftDays > rightDays) return 1;
      return left.planRow.variantId.localeCompare(right.planRow.variantId);
    });
    for (const candidate of ordered) {
      const cost = candidate.planRow.unitCostMinor!;
      const affordable = cost === 0 ? candidate.planRow.need : Math.floor(remaining / cost);
      const quantity = Math.min(candidate.planRow.need, affordable);
      const lineCostMinor = multiplyChecked(quantity, cost);
      if (lineCostMinor === null) {
        errors.push("A planned line cost exceeds safe numeric limits.");
        candidate.planRow.action = "check-data";
        candidate.planRow.reason = "Unit cost and quantity exceed safe numeric limits.";
        continue;
      }
      candidate.planRow.quantity = quantity;
      candidate.planRow.lineCostMinor = lineCostMinor;
      remaining -= lineCostMinor;
      candidate.planRow.action = quantity > 0 ? "buy" : "defer";
      candidate.planRow.reason = quantity > 0
        ? "Buy now: this is among the most urgent measurable demand."
        : "Defer: the remaining budget cannot fund a whole unit.";
    }
  }

  for (const [variantId, value] of Object.entries(edits)) {
    const candidate = candidates.find((item) => item.planRow.variantId === variantId);
    if (!candidate || !/^\d+$/.test(value)) {
      errors.push(`Invalid quantity edit for ${variantId}.`);
      continue;
    }
    const quantity = Number(value);
    if (!Number.isSafeInteger(quantity) || quantity > candidate.planRow.need) {
      errors.push(`Quantity edit for ${variantId} must be between 0 and calculated need.`);
      continue;
    }
    const lineCostMinor = multiplyChecked(quantity, candidate.planRow.unitCostMinor!);
    if (lineCostMinor === null) {
      errors.push(`Quantity edit for ${variantId} produces an unsafe line cost.`);
      candidate.planRow.quantity = 0;
      candidate.planRow.lineCostMinor = null;
      candidate.planRow.action = "check-data";
      candidate.planRow.reason = "Manual quantity produces an unsafe line cost.";
      continue;
    }
    candidate.planRow.quantity = quantity;
    candidate.planRow.lineCostMinor = lineCostMinor;
    candidate.planRow.action = quantity > 0 ? "buy" : "defer";
    candidate.planRow.reason = "Manual quantity selected for this plan.";
  }

  let totalCostMinor = 0;
  let neededUnits = 0;
  let unfilledUnits = 0;
  for (const planRow of resultRows) {
    const needed = addChecked(neededUnits, planRow.need);
    const unfilled = addChecked(unfilledUnits, planRow.need - planRow.quantity);
    const total = addChecked(totalCostMinor, planRow.lineCostMinor ?? 0);
    if (needed === null || unfilled === null || total === null) {
      errors.push("Plan totals exceed safe numeric limits.");
      totalCostMinor = 0;
      neededUnits = 0;
      unfilledUnits = 0;
      break;
    }
    neededUnits = needed;
    unfilledUnits = unfilled;
    totalCostMinor = total;
  }
  if (budgetMinor !== null && totalCostMinor > budgetMinor) {
    errors.push("Selected quantities exceed the purchase budget.");
  }

  const valid = errors.length === 0;
  if (!valid) {
    totalCostMinor = errors.length > 0 && totalCostMinor > 0 ? totalCostMinor : 0;
  }
  const remainingBudgetMinor = valid ? budgetMinor - totalCostMinor : null;
  return {
    rows: resultRows,
    currencyCode,
    inputs: copiedInputs,
    budgetMinor,
    totalCostMinor,
    remainingBudgetMinor,
    neededUnits,
    unfilledUnits,
    stockoutsBeforeDelivery,
    errors,
    exportable: valid && resultRows.some((item) => item.quantity > 0),
  };
}

export function summarizeNoSalesStock(
  rows: InventoryRow[],
  currencyCode: string | null,
  salesAvailable: boolean,
  now: Date,
): NoSalesStockSummary {
  if (!salesAvailable) {
    return {
      totalCostMinor: null,
      currencyCode,
      qualifyingVariants: 0,
      knownCostVariants: 0,
      missingCostVariants: 0,
      knownCostUnits: 0,
      missingCostUnits: 0,
      salesAvailable,
      rows: [],
    };
  }
  const qualifying = rows.filter((row) =>
    row.tracked &&
    row.isGiftCard === false &&
    Number.isSafeInteger(row.availableInventory) &&
    row.availableInventory > 0 &&
    row.units60Days === 0 &&
    variantAgeDays(row.createdAt, now) !== null &&
    variantAgeDays(row.createdAt, now)! >= 60,
  );
  let total: number | null = 0;
  let knownCostVariants = 0;
  let missingCostVariants = 0;
  let knownCostUnits = 0;
  let missingCostUnits = 0;
  const summaryRows = qualifying.map((row) => {
    const cost = costMinor(row, currencyCode);
    const lineCost = cost === null ? null : multiplyChecked(cost, row.availableInventory);
    if (lineCost === null) {
      missingCostVariants += 1;
      missingCostUnits += row.availableInventory;
      return { variantId: row.variantId, productTitle: row.productTitle, variantTitle: row.variantTitle, sku: row.sku, units: row.availableInventory, costMinor: null };
    }
    knownCostVariants += 1;
    knownCostUnits += row.availableInventory;
    total = total === null ? null : addChecked(total, lineCost);
    return { variantId: row.variantId, productTitle: row.productTitle, variantTitle: row.variantTitle, sku: row.sku, units: row.availableInventory, costMinor: cost };
  });
  return {
    totalCostMinor: qualifying.length === 0 ? 0 : knownCostVariants === 0 ? null : total,
    currencyCode,
    qualifyingVariants: qualifying.length,
    knownCostVariants,
    missingCostVariants,
    knownCostUnits,
    missingCostUnits,
    salesAvailable,
    rows: summaryRows,
  };
}
