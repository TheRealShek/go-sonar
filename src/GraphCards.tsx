import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ViewNode, ViewEdge } from './shared/protocol';

export type SymbolNode = Node<{
  label: string;
  kind: string;
  summary: string;
  grouped: boolean;
  focused: boolean;
  role?: string;
  join?: boolean;
  limitation?: string;
  newlyRevealed?: boolean;
}>;

export function SymbolCard({ data }: NodeProps<SymbolNode>) {
  const behavior = !data.grouped && !!data.role;
  const decision = behavior && ['condition', 'loop'].includes(data.kind);
  return (
    <>
      <Handle type="target" position={behavior ? Position.Top : Position.Left} />
      <div
        className={`symbol-card ${data.grouped ? 'grouped' : ''} ${data.focused ? 'focused' : ''} role-${data.role ?? 'symbol'}`}
      >
        <small>
          {data.role ?? data.kind}
          {data.grouped ? ' · static behavior' : ''}
          {data.join ? ' · join' : ''}
          {data.newlyRevealed && <span className="new-node-label">New</span>}
        </small>
        <strong>{data.label}</strong>
        <span>{data.limitation ? 'Analysis boundary · inspect details' : data.summary}</span>
      </div>
      <Handle type="source" position={behavior ? Position.Bottom : Position.Right} />
      {decision && (
        <>
          <Handle
            type="source"
            id="branch-true"
            position={Position.Bottom}
            style={{ left: '28%' }}
          />
          <Handle type="source" id="branch-false" position={Position.Right} />
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
  return (
    <section
      className="identity-card"
      aria-label="Source identity"
      onMouseEnter={(event) => event.stopPropagation()}
    >
      <div className="identity-title">
        <strong>{node?.name ?? `${caller?.name ?? 'Caller'} → ${target?.name ?? 'Target'}`}</strong>
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
      {node?.parentId && (
        <p>Within {nodes.find((n) => n.id === node.parentId)?.name ?? node.qualifiedName}</p>
      )}
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
