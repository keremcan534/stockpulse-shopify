import { describe, expect, it } from "vitest";

import type { PurchasePlan } from "./purchase-planning";
import { purchasePlanCsv } from "./purchase-csv";

function plan(overrides: Partial<PurchasePlan> = {}): PurchasePlan {
  return {
    rows: [
      {
        variantId: "v1",
        productTitle: "Shirt, \"Blue\"",
        variantTitle: "M\nTall",
        sku: "=HYPERLINK(\"https://unsafe\")",
        need: 8,
        quantity: 2,
        unitCostMinor: 250,
        lineCostMinor: 500,
        daysOfStock: 1,
        action: "buy",
        reason: "Buy now",
      },
      {
        variantId: "v2",
        productTitle: "Not selected",
        variantTitle: "One size",
        sku: null,
        need: 0,
        quantity: 0,
        unitCostMinor: 100,
        lineCostMinor: 0,
        daysOfStock: null,
        action: "no-purchase",
        reason: "No need",
      },
    ],
    currencyCode: "USD",
    inputs: { budget: "10", leadTimeDays: 7, targetCoverDays: 30, delayDays: 0, demandChangePercent: 0 },
    budgetMinor: 1000,
    totalCostMinor: 500,
    remainingBudgetMinor: 500,
    neededUnits: 8,
    unfilledUnits: 6,
    stockoutsBeforeDelivery: 1,
    errors: [],
    exportable: true,
    ...overrides,
  };
}

describe("purchasePlanCsv", () => {
  it("exports only selected valid rows with quoted CRLF cells and assumptions", () => {
    const csv = purchasePlanCsv(plan());

    expect(csv).toContain("\r\n");
    expect(csv).toContain('"Shirt, ""Blue"""');
    expect(csv).toContain('"M\nTall"');
    expect(csv).toContain("Budget");
    expect(csv).not.toContain("Not selected");
  });

  it("neutralizes spreadsheet formula text", () => {
    expect(purchasePlanCsv(plan())).toContain("'=HYPERLINK");
  });

  it("keeps validated negative numeric assumptions numeric", () => {
    const csv = purchasePlanCsv(plan({
      inputs: { budget: "10", leadTimeDays: 7, targetCoverDays: 30, delayDays: 0, demandChangePercent: -10 },
    }));

    expect(csv).toContain('"-10"');
    expect(csv).not.toContain('"\'-10"');
  });

  it("returns no CSV for invalid or empty plans", () => {
    expect(purchasePlanCsv(plan({ exportable: false }))).toBe("");
    expect(purchasePlanCsv(plan({ rows: [], exportable: true }))).toBe("");
  });
});
