import { describe, expect, it } from "vitest";

import {
  calculateInventoryRows,
  filterInventoryRows,
  sortInventoryRows,
  summarizeInventory,
} from "./inventory-metrics";
import type {
  CatalogVariant,
  InventoryRow,
  InventoryStatus,
} from "./inventory.types";

function catalogVariant(
  availableInventory: number,
  overrides: Partial<CatalogVariant> = {},
): CatalogVariant {
  return {
    variantId: "gid://shopify/ProductVariant/1",
    productTitle: "T-shirt",
    variantTitle: "Blue / M",
    sku: "BLUE-M",
    tracked: true,
    availableInventory,
    ...overrides,
  };
}

function inventoryRow(
  variantId: string,
  status: InventoryStatus,
  daysOfStock: number | null,
  productTitle: string,
): InventoryRow {
  return {
    ...catalogVariant(10, { variantId, productTitle }),
    units30Days: 10,
    units60Days: 20,
    averageDailySales: 1 / 3,
    daysOfStock,
    reorderQuantity: 0,
    status,
  };
}

describe("calculateInventoryRows", () => {
  it.each([
    {
      inventory: 15,
      units30: 30,
      units60: 30,
      status: "healthy",
      days: 15,
      reorder: 15,
    },
    {
      inventory: 14,
      units30: 30,
      units60: 30,
      status: "low-stock",
      days: 14,
      reorder: 16,
    },
    {
      inventory: 31,
      units30: 30,
      units60: 30,
      status: "healthy",
      days: 31,
      reorder: 0,
    },
    {
      inventory: 0,
      units30: 0,
      units60: 0,
      status: "out-of-stock",
      days: 0,
      reorder: 0,
    },
    {
      inventory: 8,
      units30: 0,
      units60: 0,
      status: "dead-stock",
      days: null,
      reorder: 0,
    },
  ] as const)("calculates the $status inventory boundary", (expected) => {
    const [row] = calculateInventoryRows(
      [catalogVariant(expected.inventory)],
      [
        {
          variantId: "gid://shopify/ProductVariant/1",
          units30Days: expected.units30,
          units60Days: expected.units60,
        },
      ],
      true,
    );

    expect(row.status).toBe(expected.status);
    expect(row.daysOfStock).toBe(expected.days);
    expect(row.reorderQuantity).toBe(expected.reorder);
  });

  it("uses the fixed 30-day denominator for average daily sales", () => {
    const [row] = calculateInventoryRows(
      [catalogVariant(5)],
      [{ variantId: "gid://shopify/ProductVariant/1", units30Days: 1, units60Days: 1 }],
      true,
    );

    expect(row.averageDailySales).toBeCloseTo(1 / 30);
    expect(row.daysOfStock).toBeCloseTo(150);
  });

  it("rounds a fractional reorder recommendation up to a whole unit", () => {
    const [row] = calculateInventoryRows(
      [catalogVariant(0)],
      [{ variantId: "gid://shopify/ProductVariant/1", units30Days: 1, units60Days: 1 }],
      true,
    );

    expect(row.reorderQuantity).toBe(1);
  });

  it("recommends enough stock to recover from negative inventory", () => {
    const [row] = calculateInventoryRows(
      [catalogVariant(-2)],
      [{ variantId: "gid://shopify/ProductVariant/1", units30Days: 3, units60Days: 3 }],
      true,
    );

    expect(row.status).toBe("out-of-stock");
    expect(row.daysOfStock).toBe(0);
    expect(row.reorderQuantity).toBe(5);
  });

  it("marks sales-derived values unavailable when sales history failed", () => {
    const [row] = calculateInventoryRows([catalogVariant(9)], [], false);

    expect(row).toMatchObject({
      units30Days: null,
      units60Days: null,
      averageDailySales: null,
      daysOfStock: null,
      reorderQuantity: null,
      status: "healthy",
    });
  });

  it("preserves out-of-stock status when sales history failed", () => {
    const [row] = calculateInventoryRows([catalogVariant(0)], [], false);

    expect(row.status).toBe("out-of-stock");
    expect(row.daysOfStock).toBeNull();
  });

  it("marks untracked variants without making a reorder recommendation", () => {
    const [row] = calculateInventoryRows(
      [catalogVariant(0, { tracked: false })],
      [{ variantId: "gid://shopify/ProductVariant/1", units30Days: 30, units60Days: 60 }],
      true,
    );

    expect(row.status).toBe("not-tracked");
    expect(row.daysOfStock).toBeNull();
    expect(row.reorderQuantity).toBe(0);
  });
});

describe("inventory collection helpers", () => {
  it("excludes untracked variants from inventory risk summaries", () => {
    const rows = [
      inventoryRow("tracked-low", "low-stock", 2, "A"),
      inventoryRow("tracked-out", "out-of-stock", 0, "B"),
      inventoryRow("tracked-dead", "dead-stock", null, "C"),
      {
        ...inventoryRow("untracked", "not-tracked", null, "D"),
        tracked: false,
      },
    ];

    expect(summarizeInventory(rows)).toEqual({
      tracked: 3,
      lowOrOut: 2,
      dead: 1,
    });
  });

  it("sorts risk statuses before healthy and untracked stock", () => {
    const rows = [
      inventoryRow("healthy", "healthy", 40, "A"),
      inventoryRow("untracked", "not-tracked", null, "E"),
      inventoryRow("dead", "dead-stock", null, "D"),
      inventoryRow("low-later", "low-stock", 8, "C"),
      inventoryRow("low-sooner", "low-stock", 2, "B"),
      inventoryRow("out", "out-of-stock", 0, "F"),
    ];

    expect(sortInventoryRows(rows).map((row) => row.variantId)).toEqual([
      "out",
      "low-sooner",
      "low-later",
      "dead",
      "healthy",
      "untracked",
    ]);
  });

  it.each(["t-SHIRT", "blue / m", "blue-m"])(
    "matches case-insensitive search text %s",
    (query) => {
      const row = inventoryRow("match", "dead-stock", null, "T-shirt");

      expect(
        filterInventoryRows([row], { query, status: "all" }).map(
          (item) => item.variantId,
        ),
      ).toEqual(["match"]);
    },
  );

  it("filters by status and combines it with search", () => {
    const dead = inventoryRow("dead", "dead-stock", null, "Old cap");
    const healthy = inventoryRow("healthy", "healthy", 50, "New cap");

    expect(
      filterInventoryRows([dead, healthy], {
        query: "cap",
        status: "dead-stock",
      }).map((row) => row.variantId),
    ).toEqual(["dead"]);
    expect(
      filterInventoryRows([dead, healthy], {
        query: "missing",
        status: "all",
      }),
    ).toEqual([]);
  });
});
