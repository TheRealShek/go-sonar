import type { Backend } from './backend';
import type { GraphRequest, GraphView, ProjectSummary } from './shared/protocol';
import { requestFor, validateView, VIEW_LIMIT } from './exploration';

export type PresentationMode = 'frames' | 'commit';

export interface BenchmarkConfig {
  root: string;
  query: string;
  iterations: number;
  presentation?: PresentationMode;
}

export interface RenderMeasurement {
  expansionMs: number;
  presentation?: PresentationMode;
  includesFramePresentation?: boolean;
  nodes: number;
  edges: number;
  payloadBytes: number;
  snapshot: string;
  layoutMs?: number;
  commitMs?: number;
  initialFrameMs?: number;
  fitMs?: number;
  finalFrameMs?: number;
  frameMs?: number;
}

export interface BenchmarkReport extends Partial<RenderMeasurement> {
  phase: string;
  iteration?: number;
  elapsedMs?: number;
  message?: string;
  analyzedPackages?: number;
  reusedPackages?: number;
  changedFiles?: number;
}

export async function afterCommittedFrames(
  current: () => boolean,
  frame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
): Promise<void> {
  for (let index = 0; index < 2; index++) {
    await new Promise<void>((resolve) => frame(() => resolve()));
    if (!current()) throw new Error('Benchmark superseded');
  }
}

export interface BenchmarkDriver {
  backend: Backend;
  current: () => boolean;
  opened: (project: ProjectSummary) => void;
  render: (
    view: GraphView,
    current: () => boolean,
    started: number,
    presentation?: PresentationMode,
  ) => Promise<RenderMeasurement | undefined>;
  report: (report: BenchmarkReport) => Promise<void>;
}

export async function runBenchmark(
  config: BenchmarkConfig,
  driver: BenchmarkDriver,
): Promise<void> {
  const check = () => {
    if (!driver.current()) throw new Error('Benchmark superseded');
  };

  try {
    if (
      !config.root ||
      !Number.isInteger(config.iterations) ||
      config.iterations < 1 ||
      config.iterations > 1000 ||
      (config.presentation !== undefined &&
        config.presentation !== 'frames' &&
        config.presentation !== 'commit')
    )
      throw new Error('Invalid benchmark configuration');

    check();
    const started = performance.now();
    const project = await driver.backend.open(config.root);
    check();

    driver.opened(project);
    await driver.report({
      phase: 'indexed',
      snapshot: project.snapshot,
      elapsedMs: performance.now() - started,
      ...project.stats,
    });

    const searchStarted = performance.now();
    const matches = await driver.backend.search(config.query);
    check();

    const focus = matches.find((symbol) => symbol.name === config.query) ?? matches[0];
    if (!focus) throw new Error(`No symbol matched benchmark query ${config.query}`);

    await driver.report({
      phase: 'search',
      snapshot: project.snapshot,
      elapsedMs: performance.now() - searchStarted,
    });

    let last: RenderMeasurement | undefined;
    const present = async (phase: string, request: GraphRequest, iteration?: number) => {
      check();
      const began = performance.now();
      const view = validateView(await driver.backend.graph(request), VIEW_LIMIT);
      check();
      if (view.snapshot !== project.snapshot) throw new Error('Benchmark snapshot changed');

      last = await driver.render(view, driver.current, began, config.presentation ?? 'frames');
      check();
      if (!last) throw new Error('Benchmark render was superseded');

      await driver.report({ phase, iteration, ...last });

      return view;
    };

    const initial = await present('initial', requestFor(focus.id));
    const neighbor = initial.nodes.find((node) => node.id !== focus.id && !node.parentId);

    for (let iteration = 0; iteration < config.iterations; iteration++) {
      await present(
        'expanded',
        { ...requestFor(focus.id), expanded: neighbor ? [focus.id, neighbor.id] : [focus.id] },
        iteration,
      );

      if (focus.kind === 'function' || focus.kind === 'method')
        await present('behavior', { ...requestFor(focus.id), internals: [focus.id] }, iteration);
      if (neighbor) await present('refocused', requestFor(neighbor.id), iteration);
      await present('collapsed', requestFor(focus.id), iteration);
    }

    check();
    await driver.report({ phase: 'complete', ...last, elapsedMs: performance.now() - started });
  } catch (error) {
    if (driver.current()) await driver.report({ phase: 'failure', message: String(error) });
  }
}
