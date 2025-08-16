type RetryOptions = {
  attempts: number,
  /** Delay in milliseconds  */
  delay: number
}

export async function retryWithDelay<T extends Function>(callback: T, options: RetryOptions) {
  for (let i = 0; i < options.attempts; i++) {
    try {
      callback();
      return true;
    } catch {
      await new Promise(resolve => setTimeout(resolve, options.delay));
      continue;
    }
  }

  return false;
}
