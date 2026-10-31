export const MAX_MESSAGE_LENGTH = 2000;

export interface CounterState {
  text: string;
  isNearLimit: boolean;
}

// isNearLimit trips at 90% of max so the visual warning shows up before the
// visitor actually hits the wall and loses their draft.
export function getCounterState(length: number, max: number = MAX_MESSAGE_LENGTH): CounterState {
  return {
    text: `${length} / ${max}`,
    isNearLimit: length >= max * 0.9,
  };
}
