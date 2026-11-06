// One shared budget per capture, including failed and concurrent responses.
export class CaptureBudget {
  constructor(limit = 30_000_000, concurrency = 4) {
    this.limit = limit;
    this.received = 0;
    this.active = 0;
    this.concurrency = concurrency;
    this.waiters = [];
    this.controller = new AbortController();
  }
  get signal() { return this.controller.signal; }
  check() { this.signal.throwIfAborted(); }
  stop(reason = new Error('NETWORK_BUDGET')) {
    if (this.signal.aborted) return;
    this.controller.abort(reason);
    for (const waiter of this.waiters.splice(0)) waiter.reject(reason);
  }
  consume(bytes) {
    this.check();
    this.received += bytes;
    if (this.received >= this.limit) this.stop();
    this.check();
  }
  async acquire() {
    this.check();
    if (this.active < this.concurrency) { this.active++; return; }
    await new Promise((resolve, reject) => this.waiters.push({resolve, reject}));
  }
  release() {
    const next = this.waiters.shift();
    if (next) next.resolve();
    else this.active--;
  }
}
