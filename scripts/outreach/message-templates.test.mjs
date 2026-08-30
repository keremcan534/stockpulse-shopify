import { expect, it } from "vitest";
import { followupMessage, initialMessage } from "./message-templates.mjs";

const candidate = {
  code: "P01",
  businessName: "Fictional Inventory Lab",
  businessDomain: "inventory-lab.test",
  sourceUrl: "https://evidence.example.test/shopify",
  rationale: "Public catalogue shows multiple stock states.",
  targetRole: "Inventory owner",
  channelSourceUrl: "https://contact.example.test/business",
  status: "active",
  createdAt: "2026-08-31T09:00:00.000Z",
  updatedAt: "2026-08-31T09:00:00.000Z",
  replyLabels: [],
};

it("asks permission before exposing the demo and includes an opt-out", () => {
  const body = initialMessage(candidate);
  expect(body).toContain("örnek verili demoyu göndermemi ister misiniz?");
  expect(body).toContain("tekrar mesaj göndermem");
  expect(body).not.toContain("http");
  expect(body).not.toContain("15 dakika");
});

it("personalizes with only the stored verified rationale", () => {
  expect(initialMessage(candidate)).toContain(candidate.rationale);
});

it("follow-up promises there will be no further message", () => {
  expect(followupMessage(candidate)).toContain(
    "bundan sonra tekrar yazmayacağım",
  );
});

it("trims and caps the verified rationale at 180 characters", () => {
  const longRationale = `  ${"a".repeat(200)}  `;
  const body = initialMessage({ ...candidate, rationale: longRationale });
  expect(body).toContain("a".repeat(180));
  expect(body).not.toContain("a".repeat(181));
});

it("rejects a rationale containing a line break", () => {
  expect(() =>
    initialMessage({ ...candidate, rationale: "safe\nunsafe" }),
  ).toThrow(/line break/i);
});

it("rejects a business name containing a line break", () => {
  expect(() =>
    initialMessage({
      ...candidate,
      businessName: "Fictional Lab\r\nBcc: injected",
    }),
  ).toThrow(/line break/i);
});
