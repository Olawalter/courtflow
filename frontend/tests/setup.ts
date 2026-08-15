/**
 * Minimal browser-shaped globals.
 *
 * The chain guard only needs `window.ethereum` plus the listener surface the
 * wallet store registers on, so the suite runs on the plain node environment
 * rather than pulling in a full DOM.
 */
const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

const win = {
  ethereum: undefined as unknown,
  addEventListener(event: string, handler: (...args: unknown[]) => void) {
    (listeners[event] ??= []).push(handler);
  },
  removeEventListener(event: string, handler: (...args: unknown[]) => void) {
    listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
  },
  dispatch(event: string, ...args: unknown[]) {
    (listeners[event] ?? []).forEach((h) => h(...args));
  },
};

(globalThis as unknown as { window: typeof win }).window = win;
