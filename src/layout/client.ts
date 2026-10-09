import ELKConstructor, { type ELK } from 'elkjs/lib/elk-api.js';
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker';
import { calculateLayout } from './engine';
import type { LayoutRequest, LayoutResult } from './contract';
export class LayoutClient {
  private id = 0;
  private disposed = false;
  private pending?: {
    id: number;
    resolve: (result: LayoutResult) => void;
    reject: (error: Error) => void;
  };
  private elk: ELK;
  private currentWorker?: Worker;
  private workerError?: Error;
  constructor(private createWorker: () => Worker = () => new ElkWorker()) {
    this.elk = this.createEngine();
  }
  private createEngine(): ELK {
    const worker = this.createWorker();
    this.currentWorker = worker;
    this.workerError = undefined;
    worker.addEventListener('error', (event) => {
      if (worker !== this.currentWorker) return;
      this.workerError = new Error(event.message);
      this.pending?.reject(this.workerError);
      this.pending = undefined;
    });
    // Use the API entry point and a real dedicated worker. The bundled entry
    // point chooses its in-process fake worker in some WebKit worker contexts.
    return new ELKConstructor({ workerFactory: () => worker });
  }
  layout(request: LayoutRequest): Promise<LayoutResult> {
    if (this.disposed) return Promise.reject(new Error('Layout disposed'));
    if (this.workerError) return Promise.reject(this.workerError);
    if (this.pending) {
      this.pending.reject(new Error('Layout superseded'));
      this.elk.terminateWorker();
      this.elk = this.createEngine();
    }
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending = { id, resolve, reject };
      calculateLayout(request, this.elk).then(
        (result) => {
          if (this.pending?.id !== id) return;
          this.pending = undefined;
          resolve(result);
        },
        (error) => {
          if (this.pending?.id !== id) return;
          this.pending = undefined;
          reject(error);
        },
      );
    });
  }
  dispose() {
    this.disposed = true;
    this.elk.terminateWorker();
    this.pending?.reject(new Error('Layout disposed'));
    this.pending = undefined;
  }
}
