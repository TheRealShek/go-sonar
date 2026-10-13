import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ViewNode, ViewEdge } from './shared/protocol';
import { symbolName } from './identity';
import type { DetailLevel } from './nodePresentation';

export type SymbolNode = Node<{
  label: string;
  kind: string;
  summary: string;
  grouped: boolean;
  focused: boolean;
  role?: string;
  limitation?: string;
  packageId: string;
  level: DetailLevel;
  tag?: string;
  sourceRange: string;
  type: string;
  error: boolean;
  errorDecision?: boolean;
  deferred: boolean;
  unresolved: boolean;
  onEnter?: () => void;
  onExpand?: () => void;
  brackets?: { id: string; name: string; range: string; x: number; y: number; height: number }[];
}>;

export function SymbolCard({ data }: NodeProps<SymbolNode>) {
  const behavior = !data.grouped && !!data.role;
  const decision = behavior && ['condition', 'loop'].includes(data.kind);
  return (
    <>
      <Handle type="target" position={behavior ? Position.Top : Position.Left} />
      <div
        className={`symbol-card ${data.grouped ? 'grouped' : ''} ${data.focused ? 'focused' : ''} ${data.error ? 'error-return' : ''} ${decision ? 'decision' : ''} role-${data.role ?? 'symbol'}`}
      >
        <div className="node-name">
          <strong title={data.label}>{data.label}</strong>
          {data.tag && <span className="origin-tag">{data.tag}</span>}
          {data.deferred && (
            <span className="defer-marker" title="Registers deferred cleanup">
              defer
            </span>
          )}
          {data.unresolved && (
            <span className="uncertainty" title="Concrete implementation unknown">
              ?
            </span>
          )}
          {data.onEnter && (
            <button
              className="node-action nodrag"
              aria-label={`Enter ${data.label}`}
              onClick={(event) => {
                event.stopPropagation();
                data.onEnter?.();
              }}
            >
              ↗
            </button>
          )}
          {data.onExpand && (
            <button
              className="node-action nodrag"
              onClick={(event) => {
                event.stopPropagation();
                data.onExpand?.();
              }}
            >
              Expand
            </button>
          )}
        </div>
        {!data.grouped && !data.error && data.level >= 2 && (
          <span className="node-description">{data.summary}</span>
        )}
        {!data.grouped && !data.error && data.level === 3 && (
          <span className="node-types" title={data.type}>
            {data.sourceRange} {data.type}
          </span>
        )}
        {data.grouped && data.level === 3 && <span>{data.sourceRange}</span>}
        {data.brackets?.map((group) => (
          <div
            key={group.id}
            className="source-bracket"
            style={{ left: group.x, top: group.y, height: group.height }}
          >
            <span>
              {group.name}
              {data.level === 3 ? ` · ${group.range}` : ''}
            </span>
          </div>
        ))}
      </div>
      <Handle type="source" position={behavior ? Position.Bottom : Position.Right} />
      {decision && (
        <>
          <Handle
            type="source"
            id="branch-true"
            position={data.errorDecision ? Position.Right : Position.Bottom}
            style={data.errorDecision ? undefined : { left: '50%' }}
          />
          <Handle
            type="source"
            id="branch-false"
            position={data.errorDecision ? Position.Bottom : Position.Right}
          />
        </>
      )}
      {behavior && <Handle type="source" id="dependency" position={Position.Right} />}
    </>
  );
}

export const nodeTypes = { symbol: SymbolCard };

export const formatSource = (span: { file: string; line: number; column: number }) =>
  span.file && span.line
    ? `${span.file}:${span.line}:${span.column}`
    : 'Declaration source unavailable';

export function IdentityCard({
  value,
  nodes,
  pinned,
  onPin,
  onDismiss,
  onInspect,
}: {
  value: ViewNode | ViewEdge;
  nodes: ViewNode[];
  pinned: boolean;
  onPin: () => void;
  onDismiss: () => void;
  onInspect: () => void;
}) {
  const node = 'name' in value ? value : undefined;
  const source = node?.source ?? (value as ViewEdge).evidence;
  const target = !node ? nodes.find((n) => n.id === (value as ViewEdge).target) : undefined;
  const caller = !node ? nodes.find((n) => n.id === (value as ViewEdge).source) : undefined;
  const callee = node?.relatedSymbolId ? nodes.find((n) => n.id === node.relatedSymbolId) : target;
  const parent = node?.parentId ? nodes.find((n) => n.id === node.parentId) : undefined;
  return (
    <section
      className="identity-card"
      aria-label="Source identity"
      onMouseEnter={(event) => event.stopPropagation()}
    >
      <div className="identity-title">
        <strong>
          {node
            ? symbolName(node)
            : `${caller ? symbolName(caller) : 'Caller'} → ${target ? symbolName(target) : 'Target'}`}
        </strong>
        <button aria-label="Dismiss details" onClick={onDismiss}>
          ×
        </button>
      </div>
      <code>
        {node?.signature ||
          node?.details?.expression ||
          (value as ViewEdge).expression ||
          (value as ViewEdge).label}
      </code>
      <p>{node?.packageId ?? caller?.packageId}</p>
      {node && (
        <p>
          {node.details?.callName
            ? node.details.callKind || 'Callable kind unavailable'
            : node.kind}{' '}
          ·{' '}
          {(node.kind === 'call' || node.details?.callName || node.details?.role === 'defer'
            ? node.details?.callOrigin || callee?.origin
            : node.origin) || 'Origin unknown'}
        </p>
      )}
      {node?.details?.explanation && <p>{node.details.explanation}</p>}
      {node?.details?.role === 'defer' && (
        <p>
          Deferred call: <code>{node.details.expression}</code>
        </p>
      )}
      {node?.details?.limitation && <p className="notice">{node.details.limitation}</p>}
      {node?.parentId && <p>Within {parent ? symbolName(parent) : node.qualifiedName}</p>}
      {callee && (
        <>
          <small>Target declaration</small>
          <code>{callee.signature}</code>
          <p>{callee.packageId}</p>
        </>
      )}
      {node?.details?.call && (
        <>
          <small>Resolved callable type</small>
          <code>{node.details.call.signature}</code>
        </>
      )}
      <small>{formatSource(source)}</small>
      {!node && <p>Static source relationship. It does not establish observed execution.</p>}
      <button onClick={onPin}>{pinned ? 'Details pinned' : 'Pin details'}</button>
      <button onClick={onInspect}>Inspect</button>
    </section>
  );
}
