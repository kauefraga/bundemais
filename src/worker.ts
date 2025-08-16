import Redis from 'ioredis';
import { env } from './env';
import { Payment } from './schemas';
import { retryWithDelay } from './utils';

// Promise<'vai virar lib'>
type SmartOmit<T, K extends keyof T> = Omit<T, K>;

type PaymentPayload = SmartOmit<Payment, 'processor'>;

export async function startWorker(redis: Redis) {
  while (true) {
    const payment = await redis.rpoplpush('payments_queue', 'processing_queue');

    if (!payment) {
      continue; // talvez delay?
    }

    const [correlationId, amount] = payment.split(':');

    const hash = `payments:${correlationId}`;

    // processar pagamento
    // estratégia simples do Zan
    // caso pp default falhe, chama o fallback
    // caso pp fallback falhe, chama o default
    const ok = retryWithDelay(async () => {
      const paymentPayload: PaymentPayload = {
        correlationId,
        amount: parseFloat(amount),
        requestedAt: new Date().toISOString(),
      }

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
        return;
      }

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
        return;
      }
    }, { attempts: 5, delay: 1000 });

    // se não der devolve para fila
    if (!ok) {
      await redis.lpush('payments_queue', `${correlationId}:${amount}`);
      continue;
    }

    // while (true) {
    //   const paymentPayload: PaymentPayload = {
    //     correlationId,
    //     amount: parseFloat(amount),
    //     requestedAt: new Date().toISOString(),
    //   }

    //   const response = await fetch(`${env.PP_DEFAULT_URL}/payments`, {
    //     method: 'POST',
    //     headers: {
    //       'Content-Type': 'application/json',
    //     },
    //     body: JSON.stringify(paymentPayload),
    //   });

    //   if (response.ok) {
    //     await redis.lrem('processing_queue', 1, payment);
    //     await redis.hset(hash, { ...paymentPayload, processor: 'default' });
    //     break;
    //   }

    //   const fallbackResponse = await fetch(`${env.PP_FALLBACK_URL}/payments`, {
    //     method: 'POST',
    //     headers: {
    //       'Content-Type': 'application/json',
    //     },
    //     body: JSON.stringify(paymentPayload),
    //   });

    //   if (fallbackResponse.ok) {
    //     await redis.lrem('processing_queue', 1, payment);
    //     await redis.hset(hash, { ...paymentPayload, processor: 'fallback' });
    //     break;
    //   }

    //   await new Promise(resolve => setTimeout(resolve, 30));
    // }
    await redis.sadd('payments_hashes', hash);
  }
}
