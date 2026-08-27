import type { CatalogVariant, VariantSales } from "./inventory.types";
import { loadShopifyUnitCosts } from "./shopify-costs.server";
import {
  executeGraphql,
  requirePageInfo,
  type PageInfo,
  type ShopifyGraphql,
} from "./shopify-graphql.server";

export type { ShopifyGraphql } from "./shopify-graphql.server";

export interface ShopifyInventoryResult {
  catalog: CatalogVariant[];
  sales: VariantSales[];
  salesAvailable: boolean;
  warning: string | null;
  currencyCode: string | null;
  costWarning: string | null;
}

interface CatalogNode {
  id: string;
  title: string;
  sku: string | null;
  inventoryQuantity: number;
  inventoryItem: { tracked: boolean };
  createdAt?: unknown;
  product: { title: string; status?: unknown; isGiftCard?: unknown };
}

interface LineItemNode {
  currentQuantity: number;
  variant: { id: string } | null;
}

interface LineItemsConnection {
  nodes: LineItemNode[];
  pageInfo: PageInfo;
}

interface OrderNode {
  id: string;
  createdAt: string;
  cancelledAt: string | null;
  lineItems: LineItemsConnection;
}

const SALES_WARNING =
  "Sales history is temporarily unavailable. Sales-based metrics are hidden.";
const COST_WARNING =
  "Unit costs are temporarily unavailable. Cost-based planning is hidden.";
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

const CATALOG_QUERY = `#graphql
  query StockPulseCatalog($after: String) {
    productVariants(first: 100, after: $after) {
      nodes {
        id
        title
        sku
        inventoryQuantity
        createdAt
        inventoryItem {
          tracked
        }
        product {
          title
          status
          isGiftCard
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
    shop {
      currencyCode
    }
  }
`;

const ORDERS_QUERY = `#graphql
  query StockPulseOrders($after: String, $query: String!) {
    orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT) {
      nodes {
        id
        createdAt
        cancelledAt
        lineItems(first: 250) {
          nodes {
            currentQuantity
            variant {
              id
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const ORDER_LINE_ITEMS_QUERY = `#graphql
  query StockPulseOrderLineItems($id: ID!, $after: String) {
    order(id: $id) {
      lineItems(first: 250, after: $after) {
        nodes {
          currentQuantity
          variant {
            id
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

function requireCatalogConnection(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { nodes?: unknown }).nodes)
  ) {
    throw new Error("Invalid product variants response");
  }

  const connection = value as { nodes: CatalogNode[]; pageInfo: unknown };
  return {
    nodes: connection.nodes,
    pageInfo: requirePageInfo(connection.pageInfo, "product variants"),
  };
}

function normalizeCreatedAt(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    return null;
  }
  return value;
}

function normalizeCatalogNode(node: CatalogNode): CatalogVariant {
  if (
    typeof node?.id !== "string" ||
    typeof node.title !== "string" ||
    !(typeof node.sku === "string" || node.sku === null) ||
    typeof node.inventoryQuantity !== "number" ||
    !Number.isFinite(node.inventoryQuantity) ||
    typeof node.inventoryItem?.tracked !== "boolean" ||
    typeof node.product?.title !== "string"
  ) {
    throw new Error("Invalid product variant record");
  }

  return {
    variantId: node.id,
    productTitle: node.product.title,
    variantTitle: node.title,
    sku: node.sku,
    tracked: node.inventoryItem.tracked,
    availableInventory: node.inventoryQuantity,
    createdAt: normalizeCreatedAt(node.createdAt),
    productStatus: typeof node.product.status === "string"
      ? node.product.status
      : null,
    isGiftCard: typeof node.product.isGiftCard === "boolean"
      ? node.product.isGiftCard
      : null,
    unitCost: null,
  };
}

async function loadCatalog(
  graphql: ShopifyGraphql,
): Promise<{ catalog: CatalogVariant[]; currencyCode: string | null }> {
  const catalog: CatalogVariant[] = [];
  let currencyCode: string | null = null;
  let after: string | null = null;

  do {
    const data: { productVariants?: unknown; shop?: { currencyCode?: unknown } | null } = await executeGraphql(
      graphql,
      CATALOG_QUERY,
      { after },
    );
    const connection = requireCatalogConnection(data.productVariants);
    catalog.push(...connection.nodes.map(normalizeCatalogNode));
    if (catalog.length === connection.nodes.length) {
      currencyCode = typeof data.shop?.currencyCode === "string"
        ? data.shop.currencyCode
        : null;
    }
    after = connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (after !== null);

  return { catalog, currencyCode };
}

function requireLineItemsConnection(value: unknown): LineItemsConnection {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { nodes?: unknown }).nodes)
  ) {
    throw new Error("Invalid order line items response");
  }

  const connection = value as { nodes: LineItemNode[]; pageInfo: unknown };
  return {
    nodes: connection.nodes,
    pageInfo: requirePageInfo(connection.pageInfo, "order line items"),
  };
}

function requireOrdersConnection(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { nodes?: unknown }).nodes)
  ) {
    throw new Error("Invalid orders response");
  }

  const connection = value as { nodes: OrderNode[]; pageInfo: unknown };
  return {
    nodes: connection.nodes,
    pageInfo: requirePageInfo(connection.pageInfo, "orders"),
  };
}

async function loadAdditionalLineItems(
  graphql: ShopifyGraphql,
  orderId: string,
  firstPage: LineItemsConnection,
): Promise<LineItemNode[]> {
  const lineItems = [...firstPage.nodes];
  let after = firstPage.pageInfo.hasNextPage
    ? firstPage.pageInfo.endCursor
    : null;

  while (after !== null) {
    const data: { order?: { lineItems?: unknown } | null } =
      await executeGraphql(graphql, ORDER_LINE_ITEMS_QUERY, {
        id: orderId,
        after,
      });
    if (!data.order) {
      throw new Error("Order disappeared while loading line items");
    }
    const connection = requireLineItemsConnection(data.order.lineItems);
    lineItems.push(...connection.nodes);
    after = connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  }

  return lineItems;
}

function addLineItemsToSales(
  sales: Map<string, { units30Days: number; units60Days: number }>,
  lineItems: LineItemNode[],
  createdAt: Date,
  cutoff30Days: Date,
  cutoff60Days: Date,
) {
  if (createdAt < cutoff60Days) {
    return;
  }

  for (const lineItem of lineItems) {
    if (
      !lineItem.variant ||
      typeof lineItem.variant.id !== "string" ||
      typeof lineItem.currentQuantity !== "number" ||
      lineItem.currentQuantity <= 0
    ) {
      continue;
    }

    const current = sales.get(lineItem.variant.id) ?? {
      units30Days: 0,
      units60Days: 0,
    };
    current.units60Days += lineItem.currentQuantity;
    if (createdAt >= cutoff30Days) {
      current.units30Days += lineItem.currentQuantity;
    }
    sales.set(lineItem.variant.id, current);
  }
}

async function loadSales(
  graphql: ShopifyGraphql,
  now: Date,
): Promise<VariantSales[]> {
  const cutoff30Days = new Date(
    now.getTime() - 30 * DAY_IN_MILLISECONDS,
  );
  const cutoff60Days = new Date(
    now.getTime() - 60 * DAY_IN_MILLISECONDS,
  );
  const query = `created_at:>=${cutoff60Days.toISOString()}`;
  const sales = new Map<
    string,
    { units30Days: number; units60Days: number }
  >();
  let after: string | null = null;

  do {
    const data: { orders?: unknown } = await executeGraphql(
      graphql,
      ORDERS_QUERY,
      { after, query },
    );
    const connection = requireOrdersConnection(data.orders);

    for (const order of connection.nodes) {
      if (order.cancelledAt !== null) {
        continue;
      }
      const createdAt = new Date(order.createdAt);
      if (Number.isNaN(createdAt.getTime())) {
        throw new Error("Invalid order creation date");
      }
      const firstLineItems = requireLineItemsConnection(order.lineItems);
      const lineItems = await loadAdditionalLineItems(
        graphql,
        order.id,
        firstLineItems,
      );
      addLineItemsToSales(
        sales,
        lineItems,
        createdAt,
        cutoff30Days,
        cutoff60Days,
      );
    }

    after = connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (after !== null);

  return Array.from(sales, ([variantId, units]) => ({
    variantId,
    ...units,
  }));
}

export async function loadShopifyInventory(
  graphql: ShopifyGraphql,
  now: Date,
): Promise<ShopifyInventoryResult> {
  const { catalog, currencyCode } = await loadCatalog(graphql);

  let sales: VariantSales[];
  let salesAvailable: boolean;
  let warning: string | null;
  try {
    sales = await loadSales(graphql, now);
    salesAvailable = true;
    warning = null;
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    sales = [];
    salesAvailable = false;
    warning = SALES_WARNING;
  }

  try {
    const costs = await loadShopifyUnitCosts(graphql, currencyCode);
    for (const variant of catalog) {
      variant.unitCost = costs.get(variant.variantId) ?? null;
    }
    return { catalog, sales, salesAvailable, warning, currencyCode, costWarning: null };
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    return { catalog, sales, salesAvailable, warning, currencyCode, costWarning: COST_WARNING };
  }
}
