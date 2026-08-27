import type { CatalogVariant } from "./inventory.types";
import {
  executeGraphql,
  requirePageInfo,
  type ShopifyGraphql,
} from "./shopify-graphql.server";

const COSTS_QUERY = `#graphql
  query StockPulseCosts($after: String) {
    productVariants(first: 100, after: $after) {
      nodes { id inventoryItem { unitCost { amount currencyCode } } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface CostNode {
  id: string;
  inventoryItem?: { unitCost?: unknown } | null;
}

function requireCostsConnection(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { nodes?: unknown }).nodes)
  ) {
    throw new Error("Invalid product variant costs response");
  }

  const connection = value as { nodes: CostNode[]; pageInfo: unknown };
  return {
    nodes: connection.nodes,
    pageInfo: requirePageInfo(connection.pageInfo, "product variant costs"),
  };
}

function normalizeUnitCost(
  value: unknown,
  shopCurrencyCode: string | null,
): CatalogVariant["unitCost"] {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { amount?: unknown }).amount !== "string" ||
    typeof (value as { currencyCode?: unknown }).currencyCode !== "string" ||
    shopCurrencyCode === null
  ) {
    return null;
  }

  const amount = (value as { amount: string }).amount;
  const currencyCode = (value as { currencyCode: string }).currencyCode;
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) ||
    !Number.isFinite(Number(amount)) ||
    currencyCode !== shopCurrencyCode
  ) {
    return null;
  }

  return {
    amount,
    currencyCode,
  };
}

export async function loadShopifyUnitCosts(
  graphql: ShopifyGraphql,
  shopCurrencyCode: string | null,
): Promise<Map<string, CatalogVariant["unitCost"]>> {
  const costs = new Map<string, CatalogVariant["unitCost"]>();
  const cursors = new Set<string>();
  let after: string | null = null;

  do {
    const data: { productVariants?: unknown } = await executeGraphql(
      graphql,
      COSTS_QUERY,
      { after },
    );
    const connection = requireCostsConnection(data.productVariants);
    for (const node of connection.nodes) {
      if (typeof node?.id !== "string") {
        throw new Error("Invalid product variant cost record");
      }
      costs.set(
        node.id,
        normalizeUnitCost(node.inventoryItem?.unitCost, shopCurrencyCode),
      );
    }

    if (!connection.pageInfo.hasNextPage) {
      after = null;
      continue;
    }

    const cursor = connection.pageInfo.endCursor;
    if (cursor === null || cursors.has(cursor)) {
      throw new Error("Invalid product variant costs page cursor");
    }
    cursors.add(cursor);
    after = cursor;
  } while (after !== null);

  return costs;
}
