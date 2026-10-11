import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatSource } from './GraphCards';
import { highlightGo, sourceKey } from './source';
import type { SourceExcerpt, SourceSpan } from './shared/protocol';

export function SourcePanel({
  evidence,
  selectedSource,
  onSelectedSource,
  excerpt,
  loading,
  error,
  onRetry,
  onRefresh,
}: {
  evidence?: SourceSpan;
  selectedSource?: SourceSpan;
  onSelectedSource: () => void;
  excerpt?: SourceExcerpt;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onRefresh: () => void;
}) {
  const pre = useRef<HTMLPreElement>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const lines = useMemo(() => highlightGo(excerpt?.text ?? ''), [excerpt?.text]);
  const location = sourceKey(evidence);
  useLayoutEffect(() => {
    setCopyStatus('');
    const first = pre.current?.querySelector<HTMLElement>('.source-highlight');
    if (first && pre.current) {
      pre.current.scrollTop = Math.max(0, first.offsetTop - pre.current.offsetTop - 24);
      pre.current.scrollLeft = 0;
    }
  }, [location, excerpt]);
  return (
    <section className="source" aria-label="Source evidence" aria-busy={loading}>
      <h3>Source</h3>
      {evidence ? (
        <>
          <p className="source-location">{formatSource(evidence)}</p>
          <button
            onClick={() => {
              if (!navigator.clipboard) {
                setCopyStatus('Could not copy. Select the location above to copy it.');
                return;
              }
              void navigator.clipboard
                .writeText(`${evidence.file}:${evidence.line}:${evidence.column}`)
                .then(() => setCopyStatus('Location copied'))
                .catch(() =>
                  setCopyStatus('Could not copy. Select the location above to copy it.'),
                );
            }}
          >
            Copy location
          </button>
          {copyStatus && <p role="status">{copyStatus}</p>}
        </>
      ) : (
        <p className="muted">Select a local declaration, operation, or source occurrence.</p>
      )}
      {selectedSource && sourceKey(selectedSource) !== location && (
        <button onClick={onSelectedSource}>Show selected item source</button>
      )}
      {loading && <p role="status">Loading source…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <div className="actions">
            {evidence && <button onClick={onRetry}>Retry source</button>}
            <button onClick={onRefresh}>Refresh and reopen source</button>
          </div>
        </div>
      )}
      {excerpt && (
        <pre ref={pre} tabIndex={0} aria-label="Go source excerpt">
          {lines.map((tokens, index) => (
            <span
              className={`source-line ${evidence && excerpt.firstLine + index >= evidence.line && excerpt.firstLine + index <= evidence.endLine ? 'source-highlight' : ''}`}
              key={index}
            >
              <span className="line-number" aria-hidden="true">
                {String(excerpt.firstLine + index).padStart(4)}{' '}
              </span>
              {tokens.map((token, tokenIndex) => (
                <span className={token.kind ? `syntax-${token.kind}` : undefined} key={tokenIndex}>
                  {token.text}
                </span>
              ))}
            </span>
          ))}
        </pre>
      )}
    </section>
  );
}
