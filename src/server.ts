import swagger from '@elysiajs/swagger';
import { Elysia, t } from 'elysia';
import Redis from 'ioredis';
import { env } from './env';
import { Payment } from './schemas';

const paymentBody = t.Object({
  correlationId: t.String({ format: 'uuid' }),
  amount: t.Number(),
});

const summaryQuery = t.Object({
  to: t.Optional(t.Date()),
  from: t.Optional(t.Date()),
});

export function startServer(redis: Redis) {
  const app = new Elysia()
    .use(swagger())
    .post('/payments', async ({ body }) => {
      if (body.amount === 0) {
        return // descarta rápido
      }

      const { correlationId, amount } = body;

      // await redis.lpush('payments_queue', `${crypto.randomUUID()}:${Math.random() * 50}`);
      await redis.lpush('payments_queue', `${correlationId}:${amount}`);

      return
    }, { body: paymentBody })
    .get('/payments-summary', async ({ query }) => {
      const payments_hashes = await redis.smembers('payments_hashes');

      const payments: Payment[] = [];

      for (const payment_hash of payments_hashes) {
        const payment = await redis.hmget(payment_hash, 'correlationId', 'amount', 'requestedAt', 'processor');

        if (!payment) {
          continue;
        }

        const [correlationId, amount, requestedAt, processor] = payment as string[];

        payments.push({
          correlationId,
          amount: parseFloat(amount),
          requestedAt: new Date(requestedAt),
          processor: processor as 'default' | 'fallback',
        });
      }

      if (query.to || query.from) {
        const from = query.from ? new Date(query.from) : new Date(0);
        const to = query.to ? new Date(query.to) : new Date();

        const paymentsWithDefault = payments.filter(payment =>
          payment.requestedAt >= from
          && payment.requestedAt <= to
          && payment.processor === 'default'
        );
        const paymentsWithFallback = payments.filter(payment =>
          payment.requestedAt >= from
          && payment.requestedAt <= to
          && payment.processor === 'fallback'
        );

        let defaultTotalAmount = 0;
        let fallbackTotalAmount = 0;

        for (const p of paymentsWithDefault) {
          defaultTotalAmount += p.amount;
        }

        for (const p of paymentsWithFallback) {
          fallbackTotalAmount += p.amount;
        }

        return {
          default: {
            totalRequests: paymentsWithDefault.length,
            totalAmount: defaultTotalAmount
          },
          fallback: {
            totalRequests: paymentsWithFallback.length,
            totalAmount: fallbackTotalAmount
          }
        }
      }

      const paymentsWithDefault = payments.filter(payment => payment.processor === 'default');
      const paymentsWithFallback = payments.filter(payment => payment.processor === 'fallback');

      let defaultTotalAmount = 0;
      let fallbackTotalAmount = 0;

      for (const p of paymentsWithDefault) {
        defaultTotalAmount += p.amount;
      }

      for (const p of paymentsWithFallback) {
        fallbackTotalAmount += p.amount;
      }

      return {
        default: {
          totalRequests: paymentsWithDefault.length,
          totalAmount: defaultTotalAmount
        },
        fallback: {
          totalRequests: paymentsWithFallback.length,
          totalAmount: fallbackTotalAmount
        }
      }
    }, { query: summaryQuery })
    .listen({ port: env.PORT, hostname: '0.0.0.0' });

  console.log(`:> running at ${app.server?.hostname}:${app.server?.port}`);
}
