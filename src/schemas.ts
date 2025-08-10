import { t } from 'elysia';

export const PaymentSchema = t.Object({
  correlationId: t.String({ format: 'uuid' }),
  amount: t.Number(),
  requestedAt: t.Date(),
  processor: t.Union([
    t.Literal('default'),
    t.Literal('fallback'),
  ]),
});

export type Payment = typeof PaymentSchema.static;
