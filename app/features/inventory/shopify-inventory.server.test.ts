import { describe, expect, it } from "vitest";

import { loadShopifyInventory } from "./shopify-inventory.server";

interface RecordedCall {
  query: string;
  variables: Record<string, unknown>;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function graphqlQueue(bodies: Array<unknown | Response>) {
  const calls: RecordedCall[] = [];
  const graphql = async (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => {
    calls.push({ query, variables: options?.variables ?? {} });
    const next = bodies.shift();
    if (next === undefined) {
      throw new Error("Unexpected GraphQL call");
    }
    return next instanceof Response ? next : response(next);
  };

  return { graphql, calls };
}

function catalogPage(
  nodes: Array<{
    id: string;
    title?: string;
    sku?: string | null;
    inventoryQuantity?: number;
    tracked?: boolean;
    productTitle?: string;
  }>,
  pageInfo = { hasNextPage: false, endCursor: null as string | null },
) {
  return {
    data: {
      productVariants: {
        nodes: nodes.map((node) => ({
          id: node.id,
          title: node.title ?? "Default Title",
          sku: node.sku ?? null,
          inventoryQuantity: node.inventoryQuantity ?? 0,
          inventoryItem: { tracked: node.tracked ?? true },
          product: { title: node.productTitle ?? "Product" },
        })),
        pageInfo,
      },
    },
  };
}

function ordersPage(
  nodes: Array<{
    id: string;
    createdAt: string;
    cancelledAt?: string | null;
    lineItems: Array<{
      currentQuantity: number;
      variant: { id: string } | null;
    }>;
    lineItemsPageInfo?: { hasNextPage: boolean; endCursor: string | null };
  }>,
  pageInfo = { hasNextPage: false, endCursor: null as string | null },
) {
  return {
    data: {
      orders: {
        nodes: nodes.map((node) => ({
          id: node.id,
          createdAt: node.createdAt,
          cancelledAt: node.cancelledAt ?? null,
          lineItems: {
            nodes: node.lineItems,
            pageInfo: node.lineItemsPageInfo ?? {
              hasNextPage: false,
              endCursor: null,
            },
          },
        })),
        pageInfo,
      },
    },
  };
}

const NOW = new Date("2026-08-26T12:00:00.000Z");

describe("loadShopifyInventory", () => {
  it("combines all product-variant pages without truncation", async () => {
    const { graphql, calls } = graphqlQueue([
      catalogPage(
        [
          {
            id: "variant-1",
            title: "Blue / M",
            sku: "BLUE-M",
            inventoryQuantity: 12,
            productTitle: "T-shirt",
          },
        ],
        { hasNextPage: true, endCursor: "catalog-page-2" },
      ),
      catalogPage([
        {
          id: "variant-2",
          title: "Black",
          inventoryQuantity: 4,
          tracked: false,
          productTitle: "Cap",
        },
      ]),
      ordersPage([]),
    ]);

    const result = await loadShopifyInventory(graphql, NOW);

    expect(result.catalog).toEqual([
      {
        variantId: "variant-1",
        productTitle: "T-shirt",
        variantTitle: "Blue / M",
        sku: "BLUE-M",
        tracked: true,
        availableInventory: 12,
      },
      {
        variantId: "variant-2",
        productTitle: "Cap",
        variantTitle: "Black",
        sku: null,
        tracked: false,
        availableInventory: 4,
      },
    ]);
    expect(calls.slice(0, 2).map((call) => call.variables.after)).toEqual([
      null,
      "catalog-page-2",
    ]);
  });

  it("combines order pages and additional line-item pages into both sales windows", async () => {
    const { graphql, calls } = graphqlQueue([
      catalogPage([{ id: "variant-1" }, { id: "variant-2" }]),
      ordersPage(
        [
          {
            id: "order-1",
            createdAt: "2026-08-20T10:00:00.000Z",
            lineItems: [{ currentQuantity: 2, variant: { id: "variant-1" } }],
            lineItemsPageInfo: {
              hasNextPage: true,
              endCursor: "line-page-2",
            },
          },
        ],
        { hasNextPage: true, endCursor: "orders-page-2" },
      ),
      {
        data: {
          order: {
            lineItems: {
              nodes: [
                { currentQuantity: 3, variant: { id: "variant-1" } },
                { currentQuantity: 1, variant: { id: "variant-2" } },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
      ordersPage([
        {
          id: "order-2",
          createdAt: "2026-07-10T10:00:00.000Z",
          lineItems: [{ currentQuantity: 4, variant: { id: "variant-1" } }],
        },
      ]),
    ]);

    const result = await loadShopifyInventory(graphql, NOW);

    expect(result.sales).toEqual([
      { variantId: "variant-1", units30Days: 5, units60Days: 9 },
      { variantId: "variant-2", units30Days: 1, units60Days: 1 },
    ]);
    expect(result.salesAvailable).toBe(true);
    expect(result.warning).toBeNull();
    expect(calls[1].variables.query).toBe(
      "created_at:>=2026-06-27T12:00:00.000Z",
    );
    expect(calls[2].variables).toEqual({
      id: "order-1",
      after: "line-page-2",
    });
    expect(calls[3].variables.after).toBe("orders-page-2");
  });

  it("ignores cancelled orders, removed variants, and non-positive quantities", async () => {
    const { graphql } = graphqlQueue([
      catalogPage([{ id: "variant-1" }]),
      ordersPage([
        {
          id: "cancelled",
          createdAt: "2026-08-20T10:00:00.000Z",
          cancelledAt: "2026-08-21T10:00:00.000Z",
          lineItems: [{ currentQuantity: 5, variant: { id: "variant-1" } }],
        },
        {
          id: "eligible",
          createdAt: "2026-08-20T10:00:00.000Z",
          lineItems: [
            { currentQuantity: 6, variant: null },
            { currentQuantity: 0, variant: { id: "variant-1" } },
          ],
        },
      ]),
    ]);

    const result = await loadShopifyInventory(graphql, NOW);

    expect(result.sales).toEqual([]);
  });

  it("rejects catalog GraphQL errors even when the HTTP response succeeds", async () => {
    const { graphql } = graphqlQueue([
      {
        data: { productVariants: null },
        errors: [{ message: "Access denied for productVariants" }],
      },
    ]);

    await expect(loadShopifyInventory(graphql, NOW)).rejects.toThrow(
      "Access denied for productVariants",
    );
  });

  it("rejects an invalid catalog response shape", async () => {
    const { graphql } = graphqlQueue([{ data: {} }]);

    await expect(loadShopifyInventory(graphql, NOW)).rejects.toThrow(
      "Invalid product variants response",
    );
  });

  it("returns catalog data and a warning when order history fails", async () => {
    const { graphql } = graphqlQueue([
      catalogPage([
        {
          id: "variant-1",
          inventoryQuantity: 7,
          productTitle: "T-shirt",
        },
      ]),
      response({ message: "Service unavailable" }, 503),
    ]);

    const result = await loadShopifyInventory(graphql, NOW);

    expect(result.catalog).toHaveLength(1);
    expect(result.sales).toEqual([]);
    expect(result.salesAvailable).toBe(false);
    expect(result.warning).toBe(
      "Sales history is temporarily unavailable. Sales-based metrics are hidden.",
    );
  });
});
