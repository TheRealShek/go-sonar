import { afterCommittedFrames, type PresentationMode } from './benchmark';
export interface PresentationTiming {
  initialFrameMs: number;
  fitMs: number;
  finalFrameMs: number;
  frameMs: number;
}
// The caller commits graph geometry first. Actual animation frames are required;
// a timeout cannot establish that WebKit has painted a hidden workspace.
export async function measurePresentation(
  current: () => boolean,
  fit: () => Promise<unknown>,
  frame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  now: () => number = () => performance.now(),
  mode: PresentationMode = 'frames',
): Promise<PresentationTiming> {
  if (mode === 'commit') {
    if (!current()) throw new Error('Presentation superseded');
    return { initialFrameMs: 0, fitMs: 0, finalFrameMs: 0, frameMs: 0 };
  }
  const started = now();
  await afterCommittedFrames(current, frame);
  const beforeFit = now();
  await fit();
  if (!current()) throw new Error('Presentation superseded');
  const afterFit = now();
  await afterCommittedFrames(current, frame);
  const done = now();
  return {
    initialFrameMs: beforeFit - started,
    fitMs: afterFit - beforeFit,
    finalFrameMs: done - afterFit,
    frameMs: beforeFit - started + done - afterFit,
  };
}
