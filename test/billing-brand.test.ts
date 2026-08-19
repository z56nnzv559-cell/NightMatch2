import { env } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { finalizeInvoice } from "../src/billing";
import { seedDeal } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

it("店舗へ送るStripe請求書の説明文はNightMatch名義にする", async () => {
  const f = await seedDeal();
  const invoiceId = `inv_brand_${crypto.randomUUID()}`;

  await env.DB.prepare(
    `INSERT INTO ledger_entries
       (id, deal_id, party, kind, state, amount, fee_plan_id, settled_ref)
     VALUES (?, ?, 'shop_fee', 'trial', 'confirmed', 3000, ?, ?)`
  )
    .bind(crypto.randomUUID(), f.dealId, f.feePlanId, invoiceId)
    .run();
  await env.DB.prepare(
    `INSERT INTO invoices (id, shop_id, period, subtotal, status)
     VALUES (?, ?, '2026-08', 3000, 'draft')`
  )
    .bind(invoiceId, f.shopId)
    .run();

  let invoiceDescription = "";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://api.stripe.com/v1/invoices") {
      const params = new URLSearchParams(String(init?.body ?? ""));
      invoiceDescription = params.get("description") ?? "";
      return Response.json({ id: "in_brand" });
    }
    return Response.json({ id: "ok" });
  });

  const result = await finalizeInvoice(env, invoiceId, "test-admin@example.jp");
  expect(result).toEqual({ ok: true, stripeInvoiceId: "in_brand" });
  expect(invoiceDescription).toBe("NightMatch 成果報酬 2026-08");
  expect(invoiceDescription).not.toContain("灯");
  expect(invoiceDescription).not.toContain("AKARI");
});
