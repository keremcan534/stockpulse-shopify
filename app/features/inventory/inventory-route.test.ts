import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  loadShopifyInventory: vi.fn(),
  routeError: vi.fn(),
  boundaryError: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useRouteError: mocks.routeError };
});

vi.mock("@shopify/shopify-app-react-router/server", () => ({
  boundary: { error: mocks.boundaryError, headers: vi.fn() },
}));

vi.mock("../../shopify.server", () => ({
  authenticate: { admin: mocks.authenticateAdmin },
}));

vi.mock("./shopify-inventory.server", () => ({
  loadShopifyInventory: mocks.loadShopifyInventory,
}));

import { ErrorBoundary, loader } from "../../routes/app._index";

describe("inventory dashboard loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.boundaryError.mockReturnValue(null);
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
          createdAt: "2020-01-01T00:00:00.000Z",
          productStatus: "ACTIVE",
          isGiftCard: false,
          unitCost: null,
        },
        {
          variantId: "low",
          productTitle: "Low shirt",
          variantTitle: "Default",
          sku: "LOW",
          tracked: true,
          availableInventory: 4,
          createdAt: "2020-01-01T00:00:00.000Z",
          productStatus: "ACTIVE",
          isGiftCard: false,
          unitCost: null,
        },
      ],
      sales: [
        { variantId: "healthy", units30Days: 30, units60Days: 60 },
        { variantId: "low", units30Days: 30, units60Days: 60 },
      ],
      salesAvailable: true,
      warning: null,
      currencyCode: "USD",
      costWarning: null,
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

  it("preserves authentication redirects from the Shopify authenticator", async () => {
    const authResponse = new Response(null, {
      status: 302,
      headers: { Location: "/auth" },
    });
    mocks.authenticateAdmin.mockRejectedValueOnce(authResponse);

    await expect(loader({
      request: new Request("https://stockpulse.test/app"),
      url: new URL("https://stockpulse.test/app"),
      pattern: "/app",
      params: {},
      context: {},
    })).rejects.toBe(authResponse);
    expect(mocks.loadShopifyInventory).not.toHaveBeenCalled();
  });

  it("renders a sanitized retry screen for upstream HTTP failures", () => {
    mocks.routeError.mockReturnValue({
      status: 503,
      statusText: "Service Unavailable",
      internal: false,
      data: "private upstream detail",
    });

    render(createElement(ErrorBoundary));

    expect(screen.getByText("Retry")).toBeInTheDocument();
    expect(screen.queryByText("private upstream detail")).not.toBeInTheDocument();
    expect(mocks.boundaryError).not.toHaveBeenCalled();
  });

  it("delegates Shopify authentication error responses to its boundary", () => {
    const authError = {
      status: 401,
      statusText: "Unauthorized",
      internal: false,
      data: "",
    };
    mocks.routeError.mockReturnValue(authError);

    render(createElement(ErrorBoundary));

    expect(mocks.boundaryError).toHaveBeenCalledWith(authError);
  });
});
