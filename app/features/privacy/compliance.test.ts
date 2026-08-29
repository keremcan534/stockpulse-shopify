// @vitest-environment node
import "@shopify/shopify-app-react-router/adapters/node";
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";

const store = vi.hoisted(() => ({ shops: [] as string[], fail: false }));
vi.mock("../../db.server", () => ({ default: { session: {
  deleteMany: async ({ where }: { where: { shop: string } }) => {
    if (store.fail) throw new Error("Database unavailable");
    store.shops = store.shops.filter((shop) => shop !== where.shop);
  },
} } }));
vi.mock("../../shopify.server", async () => {
  const { shopifyApp, ApiVersion, AppDistribution } = await import("@shopify/shopify-app-react-router/server");
  const app = shopifyApp({
    apiKey: "pilot-test-key", apiSecretKey: "pilot-test-secret", appUrl: "https://stockpulse.example",
    apiVersion: ApiVersion.July26, distribution: AppDistribution.AppStore,
    logger: { level: 0 },
    sessionStorage: {
      storeSession: async () => true, loadSession: async () => undefined,
      deleteSession: async () => true, deleteSessions: async () => true,
      findSessionsByShop: async () => [],
    },
  });
  return { authenticate: app.authenticate };
});

import { action } from "../../routes/webhooks.compliance";

function request(topic: string, payload: unknown, signature = true, shop = "alpha.myshopify.com") {
  const body = JSON.stringify(payload);
  return new Request("https://stockpulse.example/webhooks/compliance", {
    method: "POST", body,
    headers: {
      "content-type": "application/json", "x-shopify-topic": topic,
      "x-shopify-shop-domain": shop, "x-shopify-api-version": "2026-07",
      "x-shopify-webhook-id": "00000000-0000-4000-8000-000000000001",
      "x-shopify-hmac-sha256": signature ? createHmac("sha256", "pilot-test-secret").update(body).digest("base64") : "invalid",
    },
  });
}
async function invoke(req: Request) {
  try { return await action({ request: req } as ActionFunctionArgs); }
  catch (error) { if (error instanceof Response) return error; throw error; }
}

describe("privacy webhook boundary", () => {
  beforeEach(() => { store.shops = ["alpha.myshopify.com", "alpha.myshopify.com", "beta.myshopify.com"]; store.fail = false; });
  it("rejects a forged signature without deleting sessions", async () => {
    expect((await invoke(request("shop/redact", { shop_domain: "alpha.myshopify.com" }, false))).status).toBe(401);
    expect(store.shops).toHaveLength(3);
  });
  it("deletes only the verified shop, without requiring an installed session, and tolerates retries", async () => {
    expect((await invoke(request("shop/redact", { shop_domain: "alpha.myshopify.com" }))).status).toBe(200);
    expect(store.shops).toEqual(["beta.myshopify.com"]);
    expect((await invoke(request("shop/redact", { shop_domain: "alpha.myshopify.com" }))).status).toBe(200);
    expect(store.shops).toEqual(["beta.myshopify.com"]);
  });
  it("rejects a signed payload with a mismatched shop before deletion", async () => {
    expect((await invoke(request("shop/redact", { shop_domain: "beta.myshopify.com" }))).status).toBe(400);
    expect(store.shops).toHaveLength(3);
  });
  it.each([null, {}, { shop_domain: "" }])("rejects invalid shop payload %j", async (payload) => {
    expect((await invoke(request("shop/redact", payload))).status).toBe(400);
    expect(store.shops).toHaveLength(3);
  });
  it.each(["customers/data_request", "customers/redact"])("acknowledges %s without retaining or echoing customer data", async (topic) => {
    const response = await invoke(request(topic, { shop_domain: "alpha.myshopify.com", customer: { id: 5, email: "private@example.com" } }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(store.shops).toHaveLength(3);
  });
  it("rejects unrelated signed topics", async () => {
    expect((await invoke(request("products/update", { shop_domain: "alpha.myshopify.com" }))).status).toBe(400);
    expect(store.shops).toHaveLength(3);
  });
  it("does not acknowledge failed deletion so delivery can be retried", async () => {
    store.fail = true;
    await expect(invoke(request("shop/redact", { shop_domain: "alpha.myshopify.com" }))).rejects.toThrow("Database unavailable");
  });
  it("rejects GET", async () => {
    expect((await invoke(new Request("https://stockpulse.example/webhooks/compliance"))).status).toBe(405);
  });
});
