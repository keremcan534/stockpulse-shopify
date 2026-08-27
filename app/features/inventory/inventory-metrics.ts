import type {
  CatalogVariant,
  InventoryFilters,
  InventoryRow,
  InventoryStatus,
  InventorySummary,
  VariantSales,
} from "./inventory.types";

export const SALES_WINDOW_DAYS = 30;
export const LOW_STOCK_DAYS = 14;
export const REORDER_TARGET_DAYS = 30;

const statusOrder: Record<InventoryStatus, number> = {
  "out-of-stock": 0,
  "low-stock": 1,
  "dead-stock": 2,
  healthy: 3,
  "not-tracked": 4,
};

function getTrackedStatus(
  availableInventory: number,
  units60Days: number,
  averageDailySales: number,
  daysOfStock: number | null,
): InventoryStatus {
  if (availableInventory <= 0) {
    return "out-of-stock";
  }

  if (units60Days === 0) {
    return "dead-stock";
  }

  if (
    averageDailySales > 0 &&
    daysOfStock !== null &&
    daysOfStock <= LOW_STOCK_DAYS
  ) {
    return "low-stock";
  }

  return "healthy";
}

export function calculateInventoryRows(
  catalog: CatalogVariant[],
  sales: VariantSales[],
  salesAvailable: boolean,
): InventoryRow[] {
  const salesByVariant = new Map(
    sales.map((record) => [record.variantId, record]),
  );

  return catalog.map((variant) => {
    if (!salesAvailable) {
      return {
        ...variant,
        units30Days: null,
        units60Days: null,
        averageDailySales: null,
        daysOfStock: null,
        reorderQuantity: null,
        status: !variant.tracked
          ? "not-tracked"
          : variant.availableInventory <= 0
            ? "out-of-stock"
            : "healthy",
      };
    }

    const salesRecord = salesByVariant.get(variant.variantId);
    const units30Days = salesRecord?.units30Days ?? 0;
    const units60Days = salesRecord?.units60Days ?? 0;
    const averageDailySales = units30Days / SALES_WINDOW_DAYS;
    const daysOfStock = !variant.tracked
      ? null
      : variant.availableInventory <= 0
        ? 0
        : averageDailySales > 0
          ? variant.availableInventory / averageDailySales
          : null;
    const reorderQuantity = !variant.tracked || averageDailySales === 0
      ? 0
      : Math.max(
          0,
          Math.ceil(
            units30Days * (REORDER_TARGET_DAYS / SALES_WINDOW_DAYS) -
              variant.availableInventory,
          ),
        );

    return {
      ...variant,
      units30Days,
      units60Days,
      averageDailySales,
      daysOfStock,
      reorderQuantity,
      status: variant.tracked
        ? getTrackedStatus(
            variant.availableInventory,
            units60Days,
            averageDailySales,
            daysOfStock,
          )
        : "not-tracked",
    };
  });
}

export function summarizeInventory(rows: InventoryRow[]): InventorySummary {
  return rows.reduce<InventorySummary>(
    (summary, row) => {
      if (row.tracked) {
        summary.tracked += 1;
      }
      if (row.status === "low-stock" || row.status === "out-of-stock") {
        summary.lowOrOut += 1;
      }
      if (row.status === "dead-stock") {
        summary.dead += 1;
      }
      return summary;
    },
    { tracked: 0, lowOrOut: 0, dead: 0 },
  );
}

export function filterInventoryRows(
  rows: InventoryRow[],
  filters: InventoryFilters,
): InventoryRow[] {
  const query = filters.query.trim().toLocaleLowerCase();

  return rows.filter((row) => {
    if (filters.status !== "all" && row.status !== filters.status) {
      return false;
    }

    if (!query) {
      return true;
    }

    return [row.productTitle, row.variantTitle, row.sku ?? ""].some((value) =>
      value.toLocaleLowerCase().includes(query),
    );
  });
}

export function sortInventoryRows(rows: InventoryRow[]): InventoryRow[] {
  return [...rows].sort((left, right) => {
    const statusDifference =
      statusOrder[left.status] - statusOrder[right.status];
    if (statusDifference !== 0) {
      return statusDifference;
    }

    if (left.daysOfStock !== right.daysOfStock) {
      if (left.daysOfStock === null) {
        return 1;
      }
      if (right.daysOfStock === null) {
        return -1;
      }
      return left.daysOfStock - right.daysOfStock;
    }

    const productDifference = left.productTitle.localeCompare(
      right.productTitle,
    );
    if (productDifference !== 0) {
      return productDifference;
    }

    return left.variantTitle.localeCompare(right.variantTitle);
  });
}
