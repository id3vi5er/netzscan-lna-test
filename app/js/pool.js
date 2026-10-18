// Parallelitäts-Pool: begrenzt Probes gesamt und pro Host, abbrechbar
export class Pool {
  constructor({ limit = 64, perHost = 4 } = {}) {
    this.limit = limit;
    this.perHost = perHost;
    this.running = 0;
    this.hostRunning = new Map();
    this.queue = [];
    this.controller = new AbortController();
  }

  get signal() { return this.controller.signal; }
  get aborted() { return this.controller.signal.aborted; }

  // fn(signal) → Promise; host dient nur der Begrenzung pro Gerät
  run(host, fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ host, fn, resolve, reject });
      this.#next();
    });
  }

  abort() {
    this.controller.abort();
    for (const job of this.queue.splice(0)) job.resolve(null);
  }

  #next() {
    if (this.aborted) return;
    for (let i = 0; i < this.queue.length && this.running < this.limit; i++) {
      const job = this.queue[i];
      const busy = this.hostRunning.get(job.host) || 0;
      if (busy >= this.perHost) continue;
      this.queue.splice(i--, 1);
      this.running++;
      this.hostRunning.set(job.host, busy + 1);
      Promise.resolve()
        .then(() => job.fn(this.signal))
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running--;
          const n = this.hostRunning.get(job.host) - 1;
          if (n) this.hostRunning.set(job.host, n); else this.hostRunning.delete(job.host);
          this.#next();
        });
    }
  }
}
