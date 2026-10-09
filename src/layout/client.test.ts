import { expect, it } from 'vitest';
import { LayoutClient } from './client';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
class DedicatedWorker {
  onmessage?: (event: { data: unknown }) => void;
  terminated = false;
  messages: { cmd: string; id: number; graph?: ElkNode }[] = [];
  pending?: { id: number; graph: ElkNode };
  addEventListener() {}
  postMessage(message: { cmd: string; id: number; graph?: ElkNode }) {
    this.messages.push(message);
    if (message.cmd === 'register')
      queueMicrotask(() => this.onmessage?.({ data: { id: message.id } }));
    if (message.cmd === 'layout') this.pending = { id: message.id, graph: message.graph! };
  }
  finish() {
    const message = this.pending!;
    const graph = {
      ...message.graph,
      children: message.graph.children!.map((node) => ({ ...node, x: 20, y: 30 })),
    };
    this.onmessage?.({ data: { id: message.id, data: graph } });
  }
  terminate() {
    this.terminated = true;
  }
}
it('uses the production ELK API protocol on an explicit dedicated worker without creating a nested worker', async () => {
  const worker = new DedicatedWorker();
  const client = new LayoutClient(() => worker as unknown as Worker);
  const result = client.layout({ nodes: [{ id: 'symbol', width: 220, height: 88 }], edges: [] });
  expect(worker.messages.map((message) => message.cmd)).toEqual(['register', 'layout']);
  expect(worker.pending!.graph.children![0].id).toBe('symbol');
  worker.finish();
  expect((await result).positions.symbol).toEqual({ x: 20, y: 30 });
  client.dispose();
  expect(worker.terminated).toBe(true);
});
it('terminates a superseded worker and ignores its stale completion', async () => {
  const workers: DedicatedWorker[] = [];
  const client = new LayoutClient(() => {
    const worker = new DedicatedWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const first = client.layout({ nodes: [{ id: 'old', width: 220, height: 88 }], edges: [] });
  const rejected = expect(first).rejects.toThrow('superseded');
  const second = client.layout({ nodes: [{ id: 'new', width: 220, height: 88 }], edges: [] });
  expect(workers[0].terminated).toBe(true);
  workers[0].finish();
  workers[1].finish();
  await rejected;
  expect(Object.keys((await second).positions)).toEqual(['new']);
  client.dispose();
  await expect(client.layout({ nodes: [], edges: [] })).rejects.toThrow('disposed');
});
