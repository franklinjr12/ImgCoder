/** Synchronous render context available to template components while they are evaluated. */
export interface RenderContext {
  compositionId?: string;
  width: number;
  height: number;
  locale?: string;
  props: Record<string, unknown>;
  /** 'cli' | 'studio' | 'agent' | 'chromium' — informational */
  surface?: string;
}

let current: RenderContext | null = null;

export function getRenderContext(): RenderContext {
  return current ?? { width: 0, height: 0, props: {} };
}

/** Current target locale (from `--locale`, batch matrix or Studio). */
export function getLocale(): string | undefined {
  return current?.locale;
}

export function withRenderContext<T>(ctx: RenderContext, fn: () => T): T {
  const prev = current;
  current = ctx;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

/**
 * Resolve a locale-keyed map with BCP-47 fallback: "zh-Hant-TW" → "zh-Hant" → "zh" → fallback
 * locale → first entry.
 */
export function resolveLocale<T>(map: Record<string, T> | undefined | null, locale = getLocale(), fallback = 'en'): T | undefined {
  if (!map) return undefined;
  const keys = Object.keys(map);
  if (!keys.length) return undefined;
  const lower = new Map(keys.map((k) => [k.toLowerCase(), k]));
  const tryKey = (l?: string) => {
    if (!l) return undefined;
    const parts = l.toLowerCase().split(/[-_]/);
    for (let i = parts.length; i > 0; i--) {
      const k = lower.get(parts.slice(0, i).join('-'));
      if (k) return map[k];
    }
    // match by language prefix ("zh" → "zh-CN")
    const pref = keys.find((k) => k.toLowerCase().split(/[-_]/)[0] === parts[0]);
    return pref ? map[pref] : undefined;
  };
  return tryKey(locale) ?? tryKey(fallback) ?? map[keys[0]];
}
