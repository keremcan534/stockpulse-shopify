import styles from "../features/privacy/pilot.module.css";

export default function Privacy() {
  return <main className={styles.page}>
    <nav className={styles.nav} aria-label="Public pages"><a href="/">StockPulse</a><a href="/demo">Sample demo</a></nav>
    <h1>StockPulse data use</h1>
    <p className={styles.notice}>This is a development pilot, not a published App Store service. This notice describes the current implementation; operator contact details and the production privacy policy must be finalized before accepting real-store pilots.</p>
    <section>
      <h2>Sample demo</h2>
      <p>The demo uses fictional products and sales. It does not connect to Shopify, collect contact details, or save your planner inputs. Downloaded files stay under your control. No analytics or advertising trackers are added by StockPulse.</p>
      <h2>When connected to a Shopify store</h2>
      <p>The app reads product variants, inventory, current unit costs, and available recent order line items to calculate stock coverage and purchasing suggestions. It does not place orders, update inventory, or initiate charges.</p>
      <p>StockPulse does not retain customer profiles or order payloads in its database. Inventory and sales calculations are processed for the dashboard request, not stored as a historical dataset.</p>
      <h2>What is retained</h2>
      <p>Shopify authentication sessions are stored in the app database: shop domain, access tokens, permissions, expiry and refresh-token details, and staff account metadata supplied by Shopify, such as name and email. These are needed to authenticate the installed app, not used for marketing.</p>
      <p>Store sessions are deleted on supported uninstall cleanup and verified shop-redaction requests. Customer-redaction requests have no retained customer records to erase. CSV exports you download are not removed from your device by uninstalling.</p>
      <h2>Requests and pilot limits</h2>
      <p>Shopify privacy webhooks are signature-verified. A delivery acknowledgement is not a data report: the operator must respond directly to a verified merchant data request, even when the response is that no customer records are retained.</p>
      <p>For this supervised preview, contact the person who invited you. Do not submit customer information in demo feedback. A monitored support address and the request-response procedure are prerequisites for a real-store pilot.</p>
    </section>
    <footer>Implementation notice updated 29 August 2026.</footer>
  </main>;
}
