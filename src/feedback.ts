import type { ProjectSummary } from './shared/protocol';

export function coverageLabel(diagnostics: ProjectSummary['diagnostics']): string {
  const errors = diagnostics.filter((item) => item.severity === 'error');
  if (errors.length) {
    const packages = new Set(errors.map((item) => item.packageId).filter(Boolean));
    const general = errors.filter((item) => !item.packageId).length;
    return `Partial analysis: ${packages.size ? `${packages.size} package error${packages.size === 1 ? '' : 's'}` : ''}${packages.size && general ? ' · ' : ''}${general ? `${general} analysis error${general === 1 ? '' : 's'}` : ''}`;
  }
  return `Analysis scope: ${diagnostics.length} notice${diagnostics.length === 1 ? '' : 's'}`;
}

export function isEditing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest('input, textarea, select, [contenteditable="true"]')
  );
}

export function trapFocus(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return;
  const controls = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex="0"]',
    ),
  ].filter((control) => {
    if (!control.getClientRects().length) return false;
    for (
      let parent = control.parentElement;
      parent && parent !== event.currentTarget;
      parent = parent.parentElement
    ) {
      if (
        parent instanceof HTMLDetailsElement &&
        !parent.open &&
        control !== parent.querySelector(':scope > summary')
      )
        return false;
    }
    return true;
  });
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && event.target === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && event.target === last) {
    event.preventDefault();
    first?.focus();
  }
}
