# StockPulse: no-new-cost discovery pilot

Status: local sample demonstration, not a production or App Store launch.
Do not connect external merchants until the real-store prerequisites below are met.

## What a visitor can try

- `/demo`: fictional inventory, the actual budget-based planner, delay/demand scenarios and CSV export. No Shopify login or customer records.
- `/privacy`: implementation-specific data-use notice and pilot limitations.
- `/`: product description, demo link, existing development installation login.

For an attended demonstration, run the local app and share your screen. A localhost address is accessible only on the host computer; do not send it as a public demo link. No public hosting, analytics service, mailing list, charge or automated outreach has been configured. Do not expose the development server publicly to collect interest.

Use the normal Shopify CLI development workflow for an installed development store. The standalone sample routes can also be reviewed locally without contacting Shopify using dummy app credentials and `react-router dev --host 127.0.0.1`; those credentials cannot authenticate a real store. Do not overwrite the existing .env file to run a sample preview.

## Privacy request operations

The database currently retains Shopify Session records only (including shop/staff identifiers and authentication tokens). The inventory loader processes catalog/order line items but does not persist customer profiles, order payloads, sales history or generated plans. Revisit this contract whenever persistence is added.

The shared `/webhooks/compliance` endpoint authenticates Shopify's signature, allowlists the three compliance topics and requires signed `shop_domain` to match the authenticated domain:

- `customers/data_request`: empty 200 acknowledges delivery; the app has no retained customer records to retrieve. **It does not deliver a report to the merchant.**
- `customers/redact`: no retained customer records to delete; empty 200 acknowledgement.
- `shop/redact`: deletes all sessions for that shop even after uninstall, awaits deletion before returning 200, and allows retry on database errors.

No request payloads or customer email addresses are logged or echoed. The tests exercise genuine SDK signature verification with synthetic payloads, not real customer requests.

Before any real-store pilot or public release:

1. Assign a named operator and monitored support/privacy contact; finalize the privacy notice with those details.
2. Provide a reliable intake/notification and tracking process for data requests. **The current endpoint does not queue or notify an operator. This remains a real-store launch blocker.**
3. On a verified merchant request, investigate the current storage contract and respond directly to the store owner (including a clear no-records response when applicable) within Shopify's required timeframe. A webhook acknowledgement is not fulfilment.
4. Record request receipt, owner, deadline, response and completion without copying customer payloads into demo feedback. Verify requester identity before disclosing data.
5. Define retention/deletion for production logs, backups and any future data stores; provision secure durable hosting and session storage; verify actual webhook subscriptions and delivery in the intended environment.
6. Complete production URLs, app distribution/review requirements and billing decisions separately. The checked-in example.com URLs are placeholders, not a live service.

Shopify documents a 30-day response/action window and shop-redaction delivery after uninstall. Use the current official requirements: [Privacy-law compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance).

## Safety boundaries

Do not simulate shop-redaction against an installed store: it would remove its sessions. Do not seed fake orders into a real merchant's store. Sample results are not savings, forecast accuracy, customer traction or revenue evidence. Do not send invitations or buy services without the owner's approval.
