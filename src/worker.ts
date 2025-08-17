import Redis from 'ioredis';
import { env } from './env';
import { Payment } from './schemas';
import { retryWithDelay } from './utils';

// Promise<'vai virar lib'>
type SmartOmit<T, K extends keyof T> = Omit<T, K>;

type PaymentPayload = SmartOmit<Payment, 'processor'>;

export async function startWorker(redis: Redis) {
  while (true) {
    try {
      await redis.setex('worker_lock', 10, 'locked');
    } catch {
      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }

    const payment = await redis.rpoplpush('payments_queue', 'processing_queue');

    if (!payment) {
      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }

    const [correlationId, amount] = payment.split(':');

    const hash = `payments:${correlationId}`;

    const paymentPayload: PaymentPayload = {
      correlationId,
      amount: parseFloat(amount),
      requestedAt: new Date().toISOString(),
    }

    // processar pagamento
    // estratégia simples do Zan
    // caso pp default falhe, chama o fallback
    // caso pp fallback falhe, chama o default
    const ok = await retryWithDelay(async () => {
      const response = await fetch(`${env.PP_DEFAULT_URL}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentPayload),
      });

      if (response.ok) {
        await redis.lrem('processing_queue', 1, payment);
        await redis.hset(hash, { ...paymentPayload, processor: 'default' });
      }
    }, { attempts: 3, delay: 1000 });

    // se não der devolve para fila
    if (!ok) {
      const fallbackOk = await retryWithDelay(async () => {
        const fallbackResponse = await fetch(`${env.PP_FALLBACK_URL}/payments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(paymentPayload),
        });

        if (fallbackResponse.ok) {
          await redis.lrem('processing_queue', 1, payment);
          await redis.hset(hash, { ...paymentPayload, processor: 'fallback' });
        }
      }, { attempts: 3, delay: 1000 });

      if (!fallbackOk) {
        continue;
      }
    }

    await redis.sadd('payments_hashes', hash);
    await redis.del('worker_lock');
  }
}
