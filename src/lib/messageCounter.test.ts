import { describe, it, expect } from 'vitest';
import { getCounterState, MAX_MESSAGE_LENGTH } from './messageCounter';

describe('getCounterState', () => {
  it('formats the count as "current / max"', () => {
    expect(getCounterState(42, 100).text).toBe('42 / 100');
  });

  it('defaults to MAX_MESSAGE_LENGTH when no max is given', () => {
    expect(getCounterState(10).text).toBe(`10 / ${MAX_MESSAGE_LENGTH}`);
  });

  it('is not near the limit well below the threshold', () => {
    expect(getCounterState(10, 100).isNearLimit).toBe(false);
  });

  it('is not near the limit just under the 90% threshold', () => {
    expect(getCounterState(89, 100).isNearLimit).toBe(false);
  });

  it('flags near-limit at the 90% threshold', () => {
    expect(getCounterState(90, 100).isNearLimit).toBe(true);
  });

  it('flags near-limit at the exact max', () => {
    expect(getCounterState(100, 100).isNearLimit).toBe(true);
  });
});
