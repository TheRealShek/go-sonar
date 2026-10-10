import type { GraphView, ViewNode, ViewEdge, GraphRequest } from './shared/protocol';
import { successors, MAX_FLOW_STEPS, type FlowTrail, type CallFrame } from './navigation';

export function FlowNavigator({
  view,
  request,
  trail,
  calls,
  outcomeId,
  outcomePartial,
  continuationCallId,
  functionId: inspectedFunctionId,
  onStart,
  onStep,
  onBack,
  onReveal,
  onOutcome,
  onOutcomePage,
  onReturn,
  onStop,
  busy,
  keepStepCentered,
  onKeepStepCentered,
  onResume,
  onPause,
}: {
  view?: GraphView;
  request?: GraphRequest;
  trail?: FlowTrail;
  calls: CallFrame[];
  outcomeId?: string;
  outcomePartial?: boolean;
  continuationCallId?: string;
  functionId?: string;
  onStart: (id: string) => void;
  onStep: (edge: ViewEdge) => void;
  onBack: () => void;
  onReveal: (node: ViewNode) => void;
  onOutcome: (node: ViewNode) => void;
  onOutcomePage: (id: string, offset: number) => void;
  onReturn: () => void;
  onStop: () => void;
  busy: boolean;
  keepStepCentered: boolean;
  onKeepStepCentered: (value: boolean) => void;
  onResume: () => void;
  onPause: () => void;
}) {
  if (!view || !request) return null;
  const functionId = inspectedFunctionId ?? trail?.functionId ?? request.focus;
  const behavior = view.behaviors?.find((item) => item.symbolId === functionId);
  if (!behavior && !trail && !calls.length) return null;
  const current = view.nodes.find((node) => node.id === trail?.steps.at(-1)?.nodeId);
  const next = current ? successors(view, current.id) : [];
  return (
    <div className="flow-navigation">
      {calls.length > 0 && (
        <div className="call-breadcrumb" aria-label="Call breadcrumb">
          {calls.map((frame, index) => (
            <span key={index}>
              {frame.expression} · line {frame.sourceLine}
              {calls.some((other, i) => i < index && other.targetId === frame.targetId)
                ? ' · recursive'
                : ''}
            </span>
          ))}
          <button disabled={busy} onClick={onReturn}>
            Return to caller
          </button>
        </div>
      )}
      {(trail || outcomeId) && (
        <p className="static-path">
          Static source path. Choices do not prove feasible inputs, concrete values, or observed
          execution.
        </p>
      )}
      {continuationCallId && (
        <p className="notice">
          Returned to the original call occurrence.{' '}
          {trail &&
            trail.steps.at(-1)?.nodeId !== continuationCallId &&
            'The followed path remains at its previous operation.'}
        </p>
      )}
      {outcomeId && outcomePartial && (
        <p className="notice">
          Only part of the control route is visible. Hidden regions prevent a complete
          entry-to-return comparison.
        </p>
      )}
      {(behavior?.entryId || trail) && (
        <div className="actions" aria-label="Walkthrough actions">
          {behavior?.entryId && trail?.functionId !== functionId && (
            <button disabled={busy} onClick={() => onStart(functionId)}>
              Start walkthrough
            </button>
          )}
          {trail && (
            <>
              {trail.paused && (
                <button disabled={busy} onClick={onResume}>
                  Resume walkthrough
                </button>
              )}
              <button disabled={busy} onClick={() => onStart(trail.functionId)}>
                Restart walkthrough
              </button>
              {!trail.paused && (
                <button disabled={busy} onClick={onPause}>
                  Pause walkthrough
                </button>
              )}
              <button disabled={busy} onClick={onStop}>
                Stop following
              </button>
            </>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={keepStepCentered}
              onChange={(event) => onKeepStepCentered(event.target.checked)}
            />
            Keep current step centered
          </label>
        </div>
      )}
      {trail && (
        <>
          <div className="flow-current" role="status">
            <strong>
              {trail.paused ? 'Paused' : 'Following'}: {current?.name ?? 'Hidden operation'}
            </strong>
            <span>
              Step {trail.steps.length} / {MAX_FLOW_STEPS}
            </span>
          </div>
          {trail.steps.some((step) => step.condition) && (
            <ol className="conditions" aria-label="Chosen conditions">
              {trail.steps
                .filter((step) => step.condition)
                .map((step, index) => (
                  <li key={index}>
                    <code>{step.condition}</code> → {step.branch}
                  </li>
                ))}
            </ol>
          )}
          <div className="actions">
            <button disabled={busy || trail.paused || trail.steps.length <= 1} onClick={onBack}>
              Step backward
            </button>
            {current && ['region', 'boundary'].includes(current.kind) ? (
              <button disabled={busy || trail.paused} onClick={() => onReveal(current)}>
                Reveal next region
              </button>
            ) : (
              next.map((edge) => (
                <button
                  key={edge.id}
                  disabled={busy || trail.paused || trail.steps.length >= MAX_FLOW_STEPS}
                  onClick={() => onStep(edge)}
                >
                  {current?.kind === 'loop'
                    ? ['iterate', 'next item'].includes(edge.label)
                      ? 'Follow body'
                      : ['false', 'done'].includes(edge.label)
                        ? 'Follow exit'
                        : edge.label
                    : edge.label || 'Next operation'}
                  {edge.hiddenTargetId ? ' · reveal' : ''}
                </button>
              ))
            )}
          </div>
          {current?.details?.limitation && <p className="notice">{current.details.limitation}</p>}
          {!next.length && current && !['region', 'boundary'].includes(current.kind) && (
            <p>
              {current.kind === 'exit'
                ? 'This source path reaches the function exit.'
                : current.kind === 'return'
                  ? 'This return has no visible continuation.'
                  : 'No analyzed continuation is available. This path is incomplete.'}
            </p>
          )}
          {trail.steps.length >= MAX_FLOW_STEPS && (
            <p className="notice">
              Step limit reached. Step backward or restart. Loops stay bounded.
            </p>
          )}
        </>
      )}
      {behavior && (
        <p>
          Behavior overview: {view.nodes.find((node) => node.id === functionId)?.name ?? functionId}
        </p>
      )}
      {behavior && (
        <details className="outcomes" open={!!outcomeId}>
          <summary>
            What can this return? · {behavior.returnCount} analyzed return statements
          </summary>
          {behavior.returns.map((node) => (
            <button
              key={node.id}
              className={`match ${outcomeId === node.id ? 'active' : ''}`}
              disabled={busy}
              onClick={() => onOutcome(node)}
            >
              <code>{node.details?.expression ?? node.name}</code>
              <small>Line {node.source.line}</small>
            </button>
          ))}
          <div className="actions">
            <button
              disabled={busy || behavior.returnOffset === 0}
              onClick={() => onOutcomePage(functionId, Math.max(0, behavior.returnOffset - 30))}
            >
              Previous returns
            </button>
            <button
              disabled={
                busy || behavior.returnOffset + behavior.returns.length >= behavior.returnCount
              }
              onClick={() => onOutcomePage(functionId, behavior.returnOffset + 30)}
            >
              More returns
            </button>
            {outcomeId && <button onClick={onStop}>Show alternatives</button>}
          </div>
          {behavior.incomplete && (
            <p className="notice">
              Unsupported control regions may contain other returns. This inventory is incomplete.
            </p>
          )}
          <p>
            Highlighted control connections may reach this return. Loops are visited once; route
            feasibility is unknown.
          </p>
        </details>
      )}
      {behavior && (
        <p className="muted">
          {behavior.totalNodes} source operations · {behavior.hiddenNodes} collapsed or outside this
          view{behavior.incomplete ? ' · unsupported control regions' : ''}.
        </p>
      )}
      {behavior?.incomplete && !behavior.entryId && (
        <p className="notice">
          No local behavior is available for this declaration. Inspect a local call site or the
          declared contract.
        </p>
      )}
    </div>
  );
}
