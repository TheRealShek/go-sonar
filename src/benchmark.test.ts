import { expect, it } from 'vitest';
import { afterCommittedFrames, runBenchmark, type BenchmarkReport } from './benchmark';
import { sampleBackend } from './sample';
it('waits two committed frames and rejects stale publication at a frame boundary', async () => {
  const frames: FrameRequestCallback[] = [];
  let active = true;
  const pending = afterCommittedFrames(
    () => active,
    (callback) => {
      frames.push(callback);
      return frames.length;
    },
  );
  expect(frames).toHaveLength(1);
  frames.shift()!(0);
  await Promise.resolve();
  expect(frames).toHaveLength(1);
  active = false;
  frames.shift()!(1);
  await expect(pending).rejects.toThrow('superseded');
  const successful: number[] = [];
  await afterCommittedFrames(
    () => true,
    (callback) => {
      successful.push(1);
      callback(0);
      return 1;
    },
  );
  expect(successful).toHaveLength(2);
});
it('reports bounded renders only after presentation completes and closes with complete', async () => {
  const reports: BenchmarkReport[] = [];
  let rendered = 0;
  await runBenchmark(
    { root: '/sample', query: 'Get', iterations: 2 },
    {
      backend: sampleBackend,
      current: () => true,
      opened: () => {},
      render: async (view) => {
        rendered++;
        return {
          nodes: view.nodes.length,
          edges: view.edges.length,
          payloadBytes: 123,
          expansionMs: 40,
          snapshot: view.snapshot,
        };
      },
      report: async (report) => {
        if (report.phase === 'initial') expect(rendered).toBe(1);
        reports.push(report);
      },
    },
  );
  expect(reports.map((report) => report.phase)).toEqual([
    'indexed',
    'search',
    'initial',
    'expanded',
    'behavior',
    'refocused',
    'collapsed',
    'expanded',
    'behavior',
    'refocused',
    'collapsed',
    'complete',
  ]);
  expect(
    reports.filter((report) => report.nodes !== undefined).every((report) => report.nodes! <= 80),
  ).toBe(true);
});
it('does not publish render or completion after superseded backend work', async () => {
  let active = true;
  let publications = 0;
  const reports: BenchmarkReport[] = [];
  await runBenchmark(
    { root: '/sample', query: 'Get', iterations: 1 },
    {
      backend: {
        ...sampleBackend,
        graph: async (request) => {
          active = false;
          return sampleBackend.graph(request);
        },
      },
      current: () => active,
      opened: () => {},
      render: async () => {
        publications++;
        return undefined;
      },
      report: async (report) => {
        reports.push(report);
      },
    },
  );
  expect(publications).toBe(0);
  expect(reports.some((report) => report.phase === 'complete')).toBe(false);
});
it('reports a changed analysis snapshot as failure instead of fresh rendered facts', async () => {
  const reports: BenchmarkReport[] = [];
  await runBenchmark(
    { root: '/sample', query: 'Get', iterations: 1 },
    {
      backend: {
        ...sampleBackend,
        graph: async (request) => ({ ...(await sampleBackend.graph(request)), snapshot: 'new' }),
      },
      current: () => true,
      opened: () => {},
      render: async () => {
        throw new Error('must not render');
      },
      report: async (report) => {
        reports.push(report);
      },
    },
  );
  expect(reports.at(-1)?.phase).toBe('failure');
  expect(reports.at(-1)?.message).toContain('snapshot changed');
});
it('forwards explicit background commit presentation to each bounded view', async () => {
  const modes: unknown[] = [];
  const reports: BenchmarkReport[] = [];
  await runBenchmark(
    { root: '/sample', query: 'Get', iterations: 1, presentation: 'commit' },
    {
      backend: sampleBackend,
      current: () => true,
      opened: () => {},
      render: async (view, _current, _started, presentation) => {
        modes.push(presentation);
        return {
          nodes: view.nodes.length,
          edges: view.edges.length,
          payloadBytes: 100,
          expansionMs: 20,
          snapshot: view.snapshot,
          presentation,
          includesFramePresentation: false,
          frameMs: 0,
        };
      },
      report: async (report) => {
        reports.push(report);
      },
    },
  );
  expect(modes.length).toBeGreaterThan(0);
  expect(modes.every((mode) => mode === 'commit')).toBe(true);
  expect(reports.at(-1)).toMatchObject({
    phase: 'complete',
    presentation: 'commit',
    includesFramePresentation: false,
    frameMs: 0,
  });
});
