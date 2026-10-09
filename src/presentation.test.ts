import { expect, it } from 'vitest';
import { measurePresentation } from './presentation';

it('measures real frames separately from fit latency and waits for four frame callbacks', async () => {
  let clock = 0;
  const order: string[] = [];

  const result = await measurePresentation(
    () => true,
    async () => {
      order.push('fit');
      clock += 30;
    },
    (callback) => {
      order.push('frame');
      clock += 10;
      callback(clock);
      return 1;
    },
    () => clock,
  );

  expect(order).toEqual(['frame', 'frame', 'fit', 'frame', 'frame']);
  expect(result).toEqual({ initialFrameMs: 20, fitMs: 30, finalFrameMs: 20, frameMs: 40 });
});

it('does not publish final frames if a fit response becomes obsolete', async () => {
  let valid = true;
  let frames = 0;

  const result = measurePresentation(
    () => valid,
    async () => {
      valid = false;
    },
    (callback) => {
      frames++;
      callback(0);
      return 1;
    },
  );

  await expect(result).rejects.toThrow('superseded');
  expect(frames).toBe(2);
});

it('commit-only mode never waits for frames or labels fitting as presented', async () => {
  let fitted = false;
  let frames = 0;

  const result = await measurePresentation(
    () => true,
    async () => {
      fitted = true;
    },
    () => {
      frames++;
      throw new Error('must not wait for a frame');
    },
    () => 0,
    'commit',
  );

  expect(fitted).toBe(false);
  expect(frames).toBe(0);
  expect(result.frameMs).toBe(0);
  expect(result.fitMs).toBe(0);
});
