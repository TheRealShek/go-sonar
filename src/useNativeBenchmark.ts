import { useEffect, useRef, type MutableRefObject } from 'react';
import { backend, isDesktop, benchmarkConfig, benchmarkReport } from './backend';
import { runBenchmark, type BenchmarkConfig, type BenchmarkDriver } from './benchmark';
interface BenchmarkBindings {
  active: MutableRefObject<boolean>;
  begin: (config: BenchmarkConfig) => void;
  opened: BenchmarkDriver['opened'];
  render: BenchmarkDriver['render'];
  finish: () => void;
  failed: (error: unknown) => void;
}
export function useNativeBenchmark(bindings: BenchmarkBindings): void {
  const handlers = useRef(bindings);
  handlers.current = bindings;
  useEffect(() => {
    if (!isDesktop) return;
    let mounted = true;
    const current = () => mounted;
    void benchmarkConfig()
      .then(async (config) => {
        if (!config || !current()) return;
        handlers.current.active.current = true;
        handlers.current.begin(config);
        await runBenchmark(config, {
          backend,
          current,
          opened: (project) => handlers.current.opened(project),
          render: (view, valid, started, presentation) =>
            handlers.current.render(view, valid, started, presentation),
          report: benchmarkReport,
        });
        if (current()) {
          handlers.current.active.current = false;
          handlers.current.finish();
        }
      })
      .catch((error) => {
        if (current()) {
          handlers.current.active.current = false;
          handlers.current.failed(error);
        }
      });
    return () => {
      mounted = false;
      handlers.current.active.current = false;
    };
  }, []);
}
