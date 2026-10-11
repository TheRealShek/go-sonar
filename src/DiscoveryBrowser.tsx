import { useEffect, useRef, useState, type RefObject } from 'react';
import { backend } from './backend';
import { symbolName } from './identity';
import type { Discovery, SymbolFact, SymbolPage } from './shared/protocol';

export function DiscoveryBrowser({
  enabled,
  inputRef,
  onFocus,
  onResults,
}: {
  enabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onFocus: (id: string, kind?: string) => void;
  onResults: (symbols: SymbolFact[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [packageId, setPackageId] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<SymbolPage>();
  const [discovery, setDiscovery] = useState<Discovery>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(0);
  const results = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    if (!enabled) return;
    setLoading(true);
    setPage(undefined);
    setError('');
    onResults([]);
    const timer = setTimeout(() => {
      void backend
        .find(query, kind, packageId, offset)
        .then((value) => {
          if (!current) return;
          setPage(value);
          onResults(value.symbols);
          setActive(0);
        })
        .catch((error) => {
          if (current) setError(String(error));
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 180);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [enabled, query, kind, packageId, offset, retry, onResults]);
  useEffect(() => {
    let current = true;
    if (enabled)
      void backend
        .discovery()
        .then((value) => {
          if (current) setDiscovery(value);
        })
        .catch((error) => {
          if (current) setError(String(error));
        });
    return () => {
      current = false;
    };
  }, [enabled, retry]);
  const choose = (symbol?: SymbolFact) => {
    if (symbol) onFocus(symbol.id, symbol.kind);
  };
  const focusResult = (index: number) => {
    if (!page?.symbols.length) return;
    const next = Math.max(0, Math.min(index, page.symbols.length - 1));
    setActive(next);
    results.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  };
  const suggestions = !query && !kind && !packageId;
  return (
    <section aria-label="Find declarations" className="discovery-browser">
      <label>
        Find any symbol
        <input
          ref={inputRef}
          aria-keyshortcuts="Control+k Meta+k /"
          value={query}
          disabled={!enabled}
          placeholder="Name, receiver, type, field…"
          onChange={(event) => {
            setQuery(event.target.value);
            setOffset(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              focusResult(0);
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              choose(page?.symbols[0]);
            }
          }}
        />
      </label>
      {enabled && (
        <>
          <label>
            Package
            <select
              value={packageId}
              onChange={(event) => {
                setPackageId(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">All packages</option>
              {discovery?.packages.map((pkg) => (
                <option key={pkg} value={pkg}>
                  {pkg}
                </option>
              ))}
              {packageId && !discovery?.packages.includes(packageId) && (
                <option>{packageId}</option>
              )}
            </select>
          </label>
          {discovery && discovery.packageCount > discovery.packages.length && (
            <label>
              Other package path
              <input
                value={packageId}
                placeholder="Exact package path"
                onChange={(event) => {
                  setPackageId(event.target.value);
                  setOffset(0);
                }}
              />
              <small>
                {discovery.packages.length} of {discovery.packageCount} package suggestions shown
              </small>
            </label>
          )}
          <label>
            Declaration kind
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">All kinds</option>
              {[
                'function',
                'method',
                'struct',
                'interface',
                'type',
                'field',
                'variable',
                'constant',
              ].map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </label>
          {suggestions && discovery && (
            <section className="first-exploration" aria-label="Suggested starting points">
              <h3>{discovery.entrypoints.length ? 'Entry points' : 'Library starting points'}</h3>
              {discovery.entrypoints.map((symbol) => (
                <button className="match" key={symbol.id} onClick={() => choose(symbol)}>
                  <strong>{symbolName(symbol)}</strong>
                  <small>{symbol.packageId}</small>
                </button>
              ))}
              {!discovery.entrypoints.length && (
                <>
                  <p className="muted">Choose a package above, or find a type.</p>
                  <button
                    onClick={() => {
                      setKind('struct');
                      setOffset(0);
                    }}
                  >
                    Find struct types
                  </button>
                  <button
                    onClick={() => {
                      setKind('interface');
                      setOffset(0);
                    }}
                  >
                    Find interfaces
                  </button>
                </>
              )}
            </section>
          )}
          {loading && <p role="status">Finding declarations…</p>}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button onClick={() => setRetry(retry + 1)}>Retry discovery</button>
            </div>
          )}
          {page && (
            <p role="status">
              {page.total
                ? `${offset + 1}–${offset + page.symbols.length} of ${page.total} matching declarations`
                : 'No matching declarations in the covered analysis.'}
            </p>
          )}
          <div
            className="matches"
            ref={results}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                focusResult(active + (event.key === 'ArrowDown' ? 1 : -1));
              } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                focusResult(event.key === 'Home' ? 0 : (page?.symbols.length ?? 1) - 1);
              }
            }}
          >
            {page?.symbols.map((symbol, index) => (
              <button
                className="match"
                key={symbol.id}
                onFocus={() => setActive(index)}
                onClick={() => choose(symbol)}
              >
                <strong>{symbolName(symbol)}</strong>
                <small>
                  {symbol.kind} · {symbol.packageId}
                </small>
              </button>
            ))}
          </div>
          <div className="actions">
            <button
              disabled={loading || !offset}
              onClick={() => setOffset(Math.max(0, offset - 40))}
            >
              Previous results
            </button>
            <button
              disabled={loading || !page || offset + page.symbols.length >= page.total}
              onClick={() => setOffset(offset + 40)}
            >
              More results
            </button>
          </div>
        </>
      )}
    </section>
  );
}
