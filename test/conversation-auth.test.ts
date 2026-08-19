import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { signSession } from "../src/env";
import { seedDeal } from "./fixtures";

async function workerCookie(workerId: string) {
  return `akari=${await signSession(env.JWT_SECRET, { kind: "worker", workerId })}`;
}

it("案件の当事者でなければWebSocketを開けない", async () => {
  const mine = await seedDeal();
  const other = await seedDeal();

  const res = await SELF.fetch(`https://akari.test/api/deals/${other.dealId}/socket`, {
    headers: {
      cookie: await workerCookie(mine.workerId),
      upgrade: "websocket",
    },
  });

  expect(res.status).toBe(404);
});

it("クライアントがfromとdealIdを偽っても接続時の本人情報で保存される", async () => {
  const f = await seedDeal();
  const res = await SELF.fetch(`https://akari.test/api/deals/${f.dealId}/socket`, {
    headers: {
      cookie: await workerCookie(f.workerId),
      upgrade: "websocket",
    },
  });

  expect(res.status).toBe(101);
  const socket = res.webSocket;
  expect(socket).toBeTruthy();
  socket!.accept();
  socket!.send(
    JSON.stringify({
      dealId: "dl_someone_else",
      from: `shop:${f.shopId}`,
      body: "LINE ID @nightmatch",
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 30));

  const historyRes = await SELF.fetch(`https://akari.test/api/deals/${f.dealId}/messages`, {
    headers: { cookie: await workerCookie(f.workerId) },
  });
  expect(historyRes.status).toBe(200);
  const history = await historyRes.json<{
    messages: { dealId: string; from: string; body: string }[];
  }>();
  const message = history.messages.at(-1);

  expect(message).toEqual({
    dealId: f.dealId,
    from: `worker:${f.workerId}`,
    body: "LINE ID @nightmatch",
    at: expect.any(Number),
  });

  const signals = await env.DB.prepare(
    `SELECT deal_id, detail FROM bypass_signals WHERE signal='contact_in_message'`
  ).all<{ deal_id: string; detail: string }>();
  expect(signals.results).toContainEqual({
    deal_id: f.dealId,
    detail: `worker:${f.workerId}`,
  });
  expect(signals.results.some((s) => s.deal_id === "dl_someone_else")).toBe(false);
});

it("DOのseedも案件と無関係な話者を拒否する", async () => {
  const f = await seedDeal();
  const id = env.CONVERSATION.idFromName(f.dealId);
  const res = await env.CONVERSATION.get(id).fetch("https://do/seed", {
    method: "POST",
    body: JSON.stringify({
      dealId: f.dealId,
      from: "shop:sh_attacker",
      body: "偽のスカウト",
    }),
  });

  expect(res.status).toBe(403);
});
