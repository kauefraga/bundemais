import swagger from '@elysiajs/swagger';
import { Elysia, t } from 'elysia';
import Redis from 'ioredis';
import { env } from './env';
import { Payment } from './schemas';
import { retryWithDelay } from './utils';

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
    .onError(({ set }) => {
      set.status = 500;
      return 'Internal Server Error';
    })
    .post('/payments', async ({ body }) => {
      if (body.amount === 0) {
        return // descarta rápido
      }

      const { correlationId, amount } = body;

      const ok = await retryWithDelay(async () => {
        // await redis.lpush('payments_queue', `${crypto.randomUUID()}:1`);
        await redis.lpush('payments_queue', `${correlationId}:${amount}`);
      }, { attempts: 5, delay: 500 });


      if (!ok) {
        throw new Error('Failed to enqueue payment');
      }

      return
    }, {
      body: paymentBody,
      afterHandle: ({ set }) => {
        set.status = 202;
      }
    })
    .get('/payments-summary', async ({ query }) => {
      const payments_hashes = await redis.smembers('payments_hashes');

      if (!payments_hashes) {
        return {
          default: {
            totalRequests: 0,
            totalAmount: 0
          },
          fallback: {
            totalRequests: 0,
            totalAmount: 0
          }
        }
      }

      const rawPayments = await Promise.allSettled(payments_hashes.map(ph => redis.hmget(ph, 'correlationId', 'amount', 'requestedAt', 'processor')));

      if (!rawPayments) {
        return;
      }

      const payments: Payment[] = rawPayments.filter(p => p.status === 'fulfilled').map(p => {
        const [correlationId, amount, requestedAt, processor] = p.value as string[];

        return {
          correlationId,
          amount: parseFloat(amount),
          requestedAt,
          processor: processor as 'default' | 'fallback',
        }
      });

      const from = query.from ? new Date(query.from) : new Date(0);
      const to = query.to ? new Date(query.to) : new Date();

      const paymentsWithDefault = payments.filter(payment =>
        new Date(payment.requestedAt) >= from
        && new Date(payment.requestedAt) <= to
        && payment.processor === 'default'
      );
      const paymentsWithFallback = payments.filter(payment =>
        new Date(payment.requestedAt) >= from
        && new Date(payment.requestedAt) <= to
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
          totalAmount: defaultTotalAmount,
        },
        fallback: {
          totalRequests: paymentsWithFallback.length,
          totalAmount: fallbackTotalAmount,
        }
      }
    }, { query: summaryQuery })
    .listen({ port: env.PORT, hostname: '0.0.0.0' });

  console.log(`:> running at ${app.server?.hostname}:${app.server?.port}`);
}
