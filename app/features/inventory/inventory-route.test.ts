import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  loadShopifyInventory: vi.fn(),
}));

vi.mock("../../shopify.server", () => ({
  authenticate: { admin: mocks.authenticateAdmin },
}));

vi.mock("./shopify-inventory.server", () => ({
  loadShopifyInventory: mocks.loadShopifyInventory,
}));

import { loader } from "../../routes/app._index";

describe("inventory dashboard loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdmin.mockResolvedValue({
      admin: { graphql: vi.fn() },
    });
    mocks.loadShopifyInventory.mockResolvedValue({
      catalog: [
        {
          variantId: "healthy",
          productTitle: "Healthy shirt",
          variantTitle: "Default",
          sku: "HEALTHY",
          tracked: true,
          availableInventory: 40,
        },
        {
          variantId: "low",
          productTitle: "Low shirt",
          variantTitle: "Default",
          sku: "LOW",
          tracked: true,
          availableInventory: 4,
        },
      ],
      sales: [
        { variantId: "healthy", units30Days: 30, units60Days: 60 },
        { variantId: "low", units30Days: 30, units60Days: 60 },
      ],
      salesAvailable: true,
      warning: null,
    });
  });

  it("calculates, sorts, and summarizes authenticated Shopify inventory", async () => {
    const result = await loader({
      request: new Request("https://stockpulse.test/app"),
      url: new URL("https://stockpulse.test/app"),
      pattern: "/app",
      params: {},
      context: {},
    });

    expect(result.rows.map((row) => row.variantId)).toEqual(["low", "healthy"]);
    expect(result.rows[0]).toMatchObject({
      daysOfStock: 4,
      status: "low-stock",
      reorderQuantity: 26,
    });
    expect(result.summary).toEqual({ tracked: 2, lowOrOut: 1, dead: 0 });
    expect(result.warning).toBeNull();
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
  });
});
