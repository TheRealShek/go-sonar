// One active backend query and one replaceable pending query. Obsolete responses
// still require the caller's publication guard because transport cannot cancel.
export class QueryQueue<T> {
  private active = false;
  private pending?: {
    run: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
  };
  execute(run: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.pending) this.pending.reject(new Error('Query superseded'));
      this.pending = { run, resolve, reject };
      this.drain();
    });
  }
  private drain() {
    if (this.active || !this.pending) return;
    const next = this.pending;
    this.pending = undefined;
    this.active = true;
    next
      .run()
      .then(next.resolve, next.reject)
      .finally(() => {
        this.active = false;
        this.drain();
      });
  }
}
