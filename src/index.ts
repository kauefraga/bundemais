import { Elysia, t } from 'elysia';

const paymentBody = t.Object({
  correlationId: t.String(),
  amount: t.Number(),
});

const summaryQuery = t.Object({
  to: t.Optional(t.Date()),
  from: t.Optional(t.Date()),
});

const app = new Elysia()
  .post("/payments", ({ body }) => body, { body: paymentBody })
  .get("/payments-summary", ({ query }) => query, { query: summaryQuery })
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
