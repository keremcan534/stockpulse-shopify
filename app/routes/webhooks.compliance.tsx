import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const privacyTopics = new Set(["CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT", "SHOP_REDACT"]);

export const loader = () => new Response(null, { status: 405, headers: { Allow: "POST" } });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return loader();
  const { topic, shop, payload } = await authenticate.webhook(request);
  // Check the signed body against the authenticated domain before any deletion.
  if (
    !privacyTopics.has(topic) ||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ||
    !payload || typeof payload !== "object" || payload.shop_domain !== shop
  ) {
    return new Response(null, { status: 400 });
  }

  if (topic === "SHOP_REDACT") {
    // Delivery can happen after uninstall: do not require an existing session.
    // Await deletion; failures must remain non-2xx so Shopify can retry.
    await db.session.deleteMany({ where: { shop } });
  }
  // Customer/order records are not retained by this app. A data-request
  // acknowledgement is not a report to the merchant; see the pilot runbook.
  return new Response(null, { status: 200 });
};
