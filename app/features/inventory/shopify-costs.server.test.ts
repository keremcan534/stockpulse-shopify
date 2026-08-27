import { describe, expect, it, vi } from "vitest";

import { loadShopifyInventory } from "./shopify-inventory.server";

const NOW = new Date("2026-08-27T12:00:00.000Z");

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function catalogPage(currencyCode: unknown = "USD") {
  return {
    data: {
      productVariants: {
        nodes: [
          {
            id: "variant-1",
            title: "Default",
            sku: null,
            inventoryQuantity: 7,
            createdAt: "2026-01-01T00:00:00.000Z",
            inventoryItem: { tracked: true },
            product: { title: "Shirt", status: "ACTIVE", isGiftCard: false },
          },
          {
            id: "variant-2",
            title: "Small",
            sku: null,
            inventoryQuantity: 3,
            createdAt: "2026-01-01T00:00:00.000Z",
            inventoryItem: { tracked: true },
            product: { title: "Cap", status: "ACTIVE", isGiftCard: false },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      shop: { currencyCode },
    },
  };
}

function salesPage() {
  return {
    data: {
      orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    },
  };
}

function costsPage(
  nodes: Array<{ id: string; unitCost: unknown }>,
  pageInfo = { hasNextPage: false, endCursor: null as string | null },
) {
  return {
    data: {
      productVariants: {
        nodes: nodes.map((node) => ({
          id: node.id,
          inventoryItem: { unitCost: node.unitCost },
        })),
        pageInfo,
      },
    },
  };
}

function graphqlQueue(bodies: Array<unknown | Response>) {
  const graphql = vi.fn(async (
    _query: string,
    _options?: { variables?: Record<string, unknown> },
  ) => {
    const next = bodies.shift();
    if (next === undefined) throw new Error("Unexpected GraphQL call");
    return next instanceof Response ? next : response(next);
  });
  return graphql;
}

describe("Shopify unit-cost loading", () => {
  it("merges all cost pages by variant ID while normalizing nullable costs", async () => {
    const graphql = graphqlQueue([
      catalogPage(),
      salesPage(),
      costsPage(
        [{ id: "variant-1", unitCost: { amount: "12.50", currencyCode: "USD" } }],
        { hasNextPage: true, endCursor: "cost-page-2" },
      ),
      costsPage([{ id: "variant-2", unitCost: null }]),
    ]);

    const result = await loadShopifyInventory(graphql, NOW);

    expect(result.catalog[0].unitCost).toEqual({ amount: "12.50", currencyCode: "USD" });
    expect(result.catalog[1].unitCost).toBeNull();
    expect(result.costWarning).toBeNull();
    expect(graphql.mock.calls[3][1]).toEqual({ variables: { after: "cost-page-2" } });
  });

  it("keeps catalog and sales when cost permission is denied", async () => {
    const graphql = graphqlQueue([
      catalogPage(),
      salesPage(),
      response({ errors: [{ message: "Access denied" }] }),
    ]);

    const denied = await loadShopifyInventory(graphql, NOW);

    expect(denied.salesAvailable).toBe(true);
    expect(denied.catalog[0].unitCost).toBeNull();
    expect(denied.costWarning).toBeTruthy();
  });

  it("propagates authentication control-flow from the cost query", async () => {
    const authResponse = new Response("reauthenticate", { status: 401 });
    const graphql = vi.fn()
      .mockResolvedValueOnce(response(catalogPage()))
      .mockResolvedValueOnce(response(salesPage()))
      .mockRejectedValueOnce(authResponse);

    await expect(loadShopifyInventory(graphql, NOW)).rejects.toBe(authResponse);
  });

  it("treats malformed currency and cost values as unknown", async () => {
    const graphql = graphqlQueue([
      catalogPage(123),
      salesPage(),
      costsPage([
        { id: "variant-1", unitCost: { amount: 12.5, currencyCode: "USD" } },
        { id: "variant-2", unitCost: { amount: "3.00", currencyCode: null } },
      ]),
    ]);

    const result = await loadShopifyInventory(graphql, NOW);

    expect(result.currencyCode).toBeNull();
    expect(result.catalog.map((variant) => variant.unitCost)).toEqual([null, null]);
  });
});
