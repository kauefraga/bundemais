import cluster from 'cluster';
import Redis from 'ioredis';
import { availableParallelism } from 'os';
import { env } from './env';
import { startServer } from './server';
import { startWorker } from './worker';

const redis = new Redis(env.REDIS_URL); // criar uma connection pool?

if (cluster.isPrimary) {
  const numCPUs = availableParallelism();
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  startServer(redis);
} else {
  startWorker(redis);
}
