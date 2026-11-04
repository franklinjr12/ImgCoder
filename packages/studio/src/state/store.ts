/**
 * Tiny external store (useSyncExternalStore) — no state library needed.
 */
import { useSyncExternalStore, useRef, useCallback } from 'react';

export interface Store<S> {
  get(): S;
  set(patch: Partial<S> | ((s: S) => Partial<S>)): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const k in p) {
        if (!Object.is((p as any)[k], (state as any)[k])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...p };
      listeners.forEach((l) => l());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function shallowEqual(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is(a[k], b[k]));
}

/** Select a slice; re-renders only when the (shallowly compared) slice changes. */
export function useSelector<S, T>(store: Store<S>, selector: (s: S) => T): T {
  const last = useRef<{ v: T } | null>(null);
  const get = useCallback(() => {
    const v = selector(store.get());
    if (last.current && shallowEqual(last.current.v, v)) return last.current.v;
    last.current = { v };
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, selector]);
  return useSyncExternalStore(store.subscribe, get, get);
}
