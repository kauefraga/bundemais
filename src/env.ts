function readEnv(env: string | undefined, fallback: string) {
  if (env) {
    return env;
  }

  return fallback;
}

export const env = {
  PORT: readEnv(process.env.PORT, '3000'),
  REDIS_URL: readEnv(process.env.REDIS_URL, 'redis:6379'),
  PP_DEFAULT_URL: readEnv(process.env.PAYMENT_PROCESSOR_DEFAULT_URL, 'http://payment-processor-default:8080'),
  PP_FALLBACK_URL: readEnv(process.env.PAYMENT_PROCESSOR_FALLBACK_URL, 'http://payment-processor-fallback:8080'),
};
