import cluster from 'cluster';
import { Elysia, t } from 'elysia';
import Redis from 'ioredis';
import { availableParallelism } from 'os';

const PP_DEFAULT_URL = process.env.PAYMENT_PROCESSOR_DEFAULT_URL!;
const PP_FALLBACK_URL = process.env.PAYMENT_PROCESSOR_FALLBACK_URL!;

const redis = new Redis(process.env.REDIS_URL!); // criar uma connection pool?

const paymentBody = t.Object({
  correlationId: t.String({ format: 'uuid' }),
  amount: t.Number(),
});

const summaryQuery = t.Object({
  to: t.Optional(t.Date()),
  from: t.Optional(t.Date()),
});

if (cluster.isPrimary) {
  const numCPUs = availableParallelism() / 2;
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  const app = new Elysia()
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

      const payments: Array<{
        correlationId: string;
        amount: number;
        requestedAt: Date;
      }> = [];

      for (const payment_hash of payments_hashes) {
        const payment = await redis.hmget(payment_hash, 'correlationId', 'amount', 'requestedAt');

        if (!payment || payment.length === 0) {
          continue;
        }

        const [correlationId, amount, requestedAt] = payment as string[];

        payments.push({
          correlationId,
          amount: parseFloat(amount),
          requestedAt: new Date(requestedAt),
        });
      }

      // TODO: filtrar por data

      return payments;
    }, { query: summaryQuery })
    .listen(3000);

  console.log(
    `:> running at ${app.server?.hostname}:${app.server?.port}`
  );
} else {
  // -- worker
  while (true) {
    const payment = await redis.rpoplpush('payments_queue', 'processing_queue');

    if (!payment) {
      continue; // talvez delay?
    }

    const requestedAt = new Date(); // atenção aqui!! pode precisar mudar de lugar

    const [correlationId, amount] = payment.split(':');

    const paymentPayload = {
      correlationId,
      amount: parseFloat(amount),
      requestedAt
    } // extrair tipo PaymentPayload

    // processar pagamento
    // estratégia simples do Zan
    // caso pp default falhe, chama o fallback
    // caso pp fallback falhe, chama o default
    while (true) {
      const response = await fetch(PP_DEFAULT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentPayload),
      });

      if (response.ok) {
        console.log(':> pagamento no default :)');
        await redis.lrem('processing_queue', 1, payment);
        break;
      }

      const fallbackResponse = await fetch(PP_FALLBACK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentPayload),
      });

      if (fallbackResponse.ok) {
        console.log(':> pagamento no fallback');
        await redis.lrem('processing_queue', 1, payment);
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 50)); // 50 ms
    }

    const hash = `payments:${paymentPayload.correlationId}`;
    await redis.hset(`payments:${paymentPayload.correlationId}`, paymentPayload);
    await redis.sadd('payments_hashes', hash);

    console.log(':> pagamento salvo no banco de dados');
  }
}
