import cluster from 'cluster';
import { Elysia, t } from 'elysia';
import Redis from 'ioredis';
import { availableParallelism } from 'os';

const paymentBody = t.Object({
  correlationId: t.String({ format: 'uuid' }),
  amount: t.Number(),
});

const summaryQuery = t.Object({
  to: t.Optional(t.Date()),
  from: t.Optional(t.Date()),
});

if (cluster.isPrimary) {
  const numCPUs = availableParallelism();
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  const redis = new Redis(process.env.REDIS_URL!);
  console.log('redis connected');

  const app = new Elysia()
    .post("/payments", async ({ body }) => {
      if (body.amount === 0) {
        return // descarta rápido
      }

      const { correlationId, amount } = body;
      const requestedAt = new Date();

      await redis.lpush('payments', `${correlationId}:${amount}:${requestedAt}`);

      return
    }, { body: paymentBody })
    .get("/payments-summary", ({ query }) => query, { query: summaryQuery })
    .listen(3000);

  console.log(
    `🦊 #${cluster.worker?.id} elysia is running at ${app.server?.hostname}:${app.server?.port}`
  );
} else {
  // -- worker
  // puxar mensagem da fila

  // processar pagamento

  // salvar no banco de dados

  // confirmar processamento
}
