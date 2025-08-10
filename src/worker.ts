import Redis from 'ioredis';
import { env } from './env';
import { Payment } from './schemas';

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
    while (true) {
      const paymentPayload: PaymentPayload = {
        correlationId,
        amount: parseFloat(amount),
        requestedAt: new Date()
      }

      const response = await fetch(`${env.PP_DEFAULT_URL}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentPayload),
      });

      if (response.ok) {
        console.log(':> pagamento no default :)');
        await redis.lrem('processing_queue', 1, payment);
        await redis.hset(hash, { ...paymentPayload, processor: 'default' });
        break;
      }

      const fallbackResponse = await fetch(`${env.PP_FALLBACK_URL}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentPayload),
      });

      if (fallbackResponse.ok) {
        console.log(':> pagamento no fallback');
        await redis.lrem('processing_queue', 1, payment);
        await redis.hset(hash, { ...paymentPayload, processor: 'fallback' });
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 50)); // 50 ms
    }

    await redis.sadd('payments_hashes', hash);

    console.log(':> pagamento salvo no banco de dados');
  }
}
