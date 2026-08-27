import { describe, expect, it } from "vitest";

import type { InventoryRow } from "./inventory.types";
import {
  buildPurchasePlan,
  summarizeNoSalesStock,
  type PlanningInputs,
} from "./purchase-planning";

const NOW = new Date("2026-08-27T12:00:00.000Z");
const INPUTS: PlanningInputs = {
  budget: "10",
  leadTimeDays: 7,
  targetCoverDays: 30,
  delayDays: 0,
  demandChangePercent: 0,
};

function row(overrides: Partial<InventoryRow> = {}): InventoryRow {
  return {
    variantId: "variant-a",
    productTitle: "T-shirt",
    variantTitle: "Blue",
    sku: "BLUE",
    tracked: true,
    availableInventory: 3,
    createdAt: "2026-05-19T12:00:00.000Z",
    productStatus: "ACTIVE",
    isGiftCard: false,
    unitCost: { amount: "2", currencyCode: "USD" },
    units30Days: 30,
    units60Days: 60,
    averageDailySales: 1,
    daysOfStock: 3,
    reorderQuantity: 34,
    status: "low-stock",
    ...overrides,
  };
}

describe("buildPurchasePlan", () => {
  it("allocates affordable whole units to the most urgent eligible demand", () => {
    const plan = buildPurchasePlan(
      [
        row(),
        row({ variantId: "variant-z", availableInventory: 100, daysOfStock: 100 }),
      ],
      "USD",
      INPUTS,
      NOW,
    );

    expect(plan.rows[0]).toMatchObject({
      need: 34,
      quantity: 5,
      action: "buy",
    });
    expect(plan.rows[1].quantity).toBe(0);
    expect(plan.totalCostMinor).toBe(1000);
    expect(plan.unfilledUnits).toBe(29);
    expect(plan.remainingBudgetMinor).toBe(0);
  });

  it("uses scenario demand and delay with exact integer ceiling arithmetic", () => {
    const scenario = buildPurchasePlan(
      [row()],
      "USD",
      { ...INPUTS, delayDays: 7, demandChangePercent: 30 },
      NOW,
    );
    const exact = buildPurchasePlan(
      [row({ units30Days: 31, availableInventory: 0 })],
      "USD",
      { ...INPUTS, leadTimeDays: 0, targetCoverDays: 30 },
      NOW,
    );

    expect(scenario.rows[0].need).toBe(55);
    expect(exact.rows[0].need).toBe(31);
  });

  it("clamps negative stock to zero when calculating need", () => {
    const plan = buildPurchasePlan(
      [row({ availableInventory: -2 })],
      "USD",
      { ...INPUTS, budget: "100" },
      NOW,
    );

    expect(plan.rows[0].need).toBe(37);
  });

  it("allocates genuine zero-cost units without consuming budget", () => {
    const plan = buildPurchasePlan(
      [row({ unitCost: { amount: "0", currencyCode: "USD" } })],
      "USD",
      INPUTS,
      NOW,
    );

    expect(plan.rows[0]).toMatchObject({ quantity: 34, lineCostMinor: 0, action: "buy" });
    expect(plan.remainingBudgetMinor).toBe(1000);
  });

  it("breaks equal urgency ties by variant ID", () => {
    const plan = buildPurchasePlan(
      [row({ variantId: "z" }), row({ variantId: "a" })],
      "USD",
      INPUTS,
      NOW,
    );

    expect(plan.rows.map((item) => item.quantity)).toEqual([0, 5]);
  });

  it("never exceeds a deterministic range of budgets and costs", () => {
    for (let index = 0; index < 40; index += 1) {
      const budget = String(index * 3);
      const unitCost = String((index % 7) + 1);
      const plan = buildPurchasePlan(
        [row({ unitCost: { amount: unitCost, currencyCode: "USD" } })],
        "USD",
        { ...INPUTS, budget },
        NOW,
      );

      expect(plan.totalCostMinor).toBeLessThanOrEqual(plan.budgetMinor!);
      expect(Number.isSafeInteger(plan.totalCostMinor)).toBe(true);
    }
  });

  it.each([
    ["zero budget", { ...INPUTS, budget: "0" }, row(), "defer"],
    ["missing cost", INPUTS, row({ unitCost: null }), "check-data"],
    ["currency mismatch", INPUTS, row({ unitCost: { amount: "2", currencyCode: "EUR" } }), "check-data"],
    ["malformed cost", INPUTS, row({ unitCost: { amount: "bad", currencyCode: "USD" } }), "check-data"],
    ["sales unavailable", INPUTS, row({ units30Days: null }), "check-data"],
    ["draft product", INPUTS, row({ productStatus: "DRAFT" }), "check-data"],
    ["unknown gift flag", INPUTS, row({ isGiftCard: null }), "check-data"],
    ["untracked", INPUTS, row({ tracked: false }), "check-data"],
    ["young age", INPUTS, row({ createdAt: "2026-08-10T12:00:00.000Z" }), "check-data"],
    ["future age", INPUTS, row({ createdAt: "2026-09-01T12:00:00.000Z" }), "check-data"],
    ["no velocity", INPUTS, row({ units30Days: 0 }), "no-purchase"],
  ] as const)("keeps %s rows explainable and unallocated", (_name, inputs, item, action) => {
    const plan = buildPurchasePlan([item], "USD", inputs, NOW);

    expect(plan.rows[0]).toMatchObject({ quantity: 0, action });
  });

  it("rejects invalid assumptions without allocating a purchase", () => {
    for (const inputs of [
      { ...INPUTS, budget: "" },
      { ...INPUTS, budget: "1000000001" },
      { ...INPUTS, leadTimeDays: 366 },
      { ...INPUTS, targetCoverDays: 0 },
      { ...INPUTS, delayDays: -1 },
      { ...INPUTS, demandChangePercent: 501 },
    ]) {
      const plan = buildPurchasePlan([row()], "USD", inputs, NOW);
      expect(plan.errors.length).toBeGreaterThan(0);
      expect(plan.rows[0].quantity).toBe(0);
      expect(plan.exportable).toBe(false);
    }
  });

  it("does not throw or allocate for malformed runtime input values", () => {
    const malformed = { ...INPUTS, demandChangePercent: Number.NaN } as PlanningInputs;

    expect(() => buildPurchasePlan([row()], "USD", malformed, NOW)).not.toThrow();
    expect(buildPurchasePlan([row()], "USD", malformed, NOW).exportable).toBe(false);
  });

  it("applies valid manual edits without reallocating the unedited rows", () => {
    const source = [row({ variantId: "a" }), row({ variantId: "b", availableInventory: 3 })];
    const plan = buildPurchasePlan(source, "USD", { ...INPUTS, budget: "20" }, NOW, { a: "2" });

    expect(plan.rows.map((item) => item.quantity)).toEqual([2, 0]);
    expect(source[0].availableInventory).toBe(3);
  });

  it("marks invalid and over-budget edits non-exportable", () => {
    const malformed = buildPurchasePlan([row()], "USD", INPUTS, NOW, { "variant-a": "no" });
    const overBudget = buildPurchasePlan([row()], "USD", INPUTS, NOW, { "variant-a": "34" });

    expect(malformed.errors.length).toBeGreaterThan(0);
    expect(malformed.exportable).toBe(false);
    expect(overBudget.errors.length).toBeGreaterThan(0);
    expect(overBudget.exportable).toBe(false);
  });

  it("does not emit an unsafe line cost for a manual edit", () => {
    const plan = buildPurchasePlan(
      [row({ unitCost: { amount: "90071992547409", currencyCode: "USD" } })],
      "USD",
      { ...INPUTS, budget: "1000000000" },
      NOW,
      { "variant-a": "2" },
    );

    expect(plan.errors.length).toBeGreaterThan(0);
    expect(plan.rows[0].lineCostMinor).toBeNull();
    expect(plan.exportable).toBe(false);
  });
});

describe("summarizeNoSalesStock", () => {
  it("separates known and missing costs for qualifying old zero-sales stock", () => {
    const summary = summarizeNoSalesStock(
      [
        row({ availableInventory: 10, units60Days: 0 }),
        row({ variantId: "missing", availableInventory: 5, units60Days: 0, unitCost: null }),
      ],
      "USD",
      true,
      NOW,
    );

    expect(summary).toMatchObject({
      totalCostMinor: 2000,
      knownCostVariants: 1,
      missingCostVariants: 1,
      knownCostUnits: 10,
      missingCostUnits: 5,
    });
  });

  it("returns unknown valuation when sales are unavailable or all costs are missing", () => {
    const rows = [row({ availableInventory: 10, units60Days: 0, unitCost: null })];

    expect(summarizeNoSalesStock(rows, "USD", false, NOW).totalCostMinor).toBeNull();
    expect(summarizeNoSalesStock(rows, "USD", true, NOW).totalCostMinor).toBeNull();
  });

  it("reports zero only for a known empty qualifying set", () => {
    const summary = summarizeNoSalesStock(
      [row({ units60Days: 1 }), row({ tracked: false, units60Days: 0 })],
      "USD",
      true,
      NOW,
    );

    expect(summary).toMatchObject({ totalCostMinor: 0, qualifyingVariants: 0 });
  });

  it("does not recover a cost when it is in a different currency", () => {
    const summary = summarizeNoSalesStock(
      [row({ availableInventory: 4, units60Days: 0, unitCost: { amount: "2", currencyCode: "EUR" } })],
      "USD",
      true,
      NOW,
    );

    expect(summary).toMatchObject({
      totalCostMinor: null,
      knownCostVariants: 0,
      missingCostVariants: 1,
      missingCostUnits: 4,
    });
  });
});
