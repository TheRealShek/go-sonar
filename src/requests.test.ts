import { expect, it } from 'vitest';
import { QueryQueue } from './requests';
it('bounds pending backend work and replaces obsolete requests', async () => {
  const queue = new QueryQueue<number>();
  let release!: (value: number) => void;
  const calls: number[] = [];
  const first = queue.execute(() => {
    calls.push(1);
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const second = queue.execute(async () => {
    calls.push(2);
    return 2;
  });
  const rejection = expect(second).rejects.toThrow('superseded');
  const third = queue.execute(async () => {
    calls.push(3);
    return 3;
  });
  expect(calls).toEqual([1]);
  release(1);
  expect(await first).toBe(1);
  await rejection;
  expect(await third).toBe(3);
  expect(calls).toEqual([1, 3]);
});
