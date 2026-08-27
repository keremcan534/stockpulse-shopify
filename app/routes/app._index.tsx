import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { InventoryDashboard } from "../features/inventory/inventory-dashboard";
import {
  calculateInventoryRows,
  sortInventoryRows,
  summarizeInventory,
} from "../features/inventory/inventory-metrics";
import { loadShopifyInventory } from "../features/inventory/shopify-inventory.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const now = new Date();
  const inventory = await loadShopifyInventory(admin.graphql, now);
  const rows = sortInventoryRows(
    calculateInventoryRows(
      inventory.catalog,
      inventory.sales,
      inventory.salesAvailable,
    ),
  );

  return {
    rows,
    summary: summarizeInventory(rows),
    warning: inventory.warning,
    generatedAt: now.toISOString(),
  };
};

export default function Index() {
  const data = useLoaderData<typeof loader>();

  return <InventoryDashboard {...data} />;
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (
    isRouteErrorResponse(error) &&
    (error.status < 400 || error.status === 401)
  ) {
    return boundary.error(error);
  }

  return (
    <s-page heading="StockPulse inventory">
      <s-section>
        <s-banner tone="critical" heading="Inventory could not be loaded">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Shopify data is temporarily unavailable. No inventory was
              changed. Try loading the dashboard again.
            </s-paragraph>
            <s-button onClick={() => window.location.reload()}>Retry</s-button>
          </s-stack>
        </s-banner>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
