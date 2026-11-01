// Retry with exponential backoff and a circuit breaker for calls to external
// providers (SRS 3.4, SAD 3.7).

async function retry(fn, { attempts = 3, baseMs = 50, isRetryable = () => true } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i + 1);
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetryable(err)) break;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}

class CircuitOpenError extends Error {
  constructor(name) {
    super(`Circuit '${name}' is open`);
    this.circuitOpen = true;
  }
}

class CircuitBreaker {
  constructor(name, { failureThreshold = 3, resetMs = 30_000, now = Date.now } = {}) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.resetMs = resetMs;
    this.now = now;
    this.failures = 0;
    this.state = 'CLOSED';
    this.openedAt = 0;
  }

  async call(fn) {
    if (this.state === 'OPEN') {
      if (this.now() - this.openedAt < this.resetMs) throw new CircuitOpenError(this.name);
      this.state = 'HALF_OPEN';
    }
    try {
      const result = await fn();
      this.failures = 0;
      this.state = 'CLOSED';
      return result;
    } catch (err) {
      this.failures++;
      if (this.state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
        this.state = 'OPEN';
        this.openedAt = this.now();
      }
      throw err;
    }
  }
}

module.exports = { retry, CircuitBreaker, CircuitOpenError };
