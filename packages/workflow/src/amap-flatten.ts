// AIGC START
const LNG_LAT = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/;

function amapBareName(toolName: string): string {
  return toolName.replace(/^(mcp__)?amap-maps__/i, '');
}

export function extractAmapLocation(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (LNG_LAT.test(trimmed)) return trimmed.replace(/\s+/g, '');
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 20_000) {
      try {
        return extractAmapLocation(JSON.parse(trimmed) as unknown);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return undefined;
  if (Array.isArray(value)) {
    if (
      value.length >= 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number' &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1])
    ) {
      return `${value[0]},${value[1]}`;
    }
    for (const item of value) {
      const hit = extractAmapLocation(item);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const rec = value as Record<string, unknown>;
  for (const key of ['location', 'results', 'return', 'geocodes', 'pois']) {
    if (key in rec) {
      const hit = extractAmapLocation(rec[key]);
      if (hit) return hit;
    }
  }
  const lng = rec.lng ?? rec.longitude;
  const lat = rec.lat ?? rec.latitude;
  if (typeof lng === 'number' && typeof lat === 'number') return `${lng},${lat}`;
  if (typeof lng === 'string' && typeof lat === 'string' && LNG_LAT.test(`${lng},${lat}`)) {
    return `${lng},${lat}`;
  }
  return undefined;
}

export function flattenAmapToolResult(toolName: string, result: unknown): unknown {
  const name = amapBareName(toolName);
  if (name !== 'maps_geo' && name !== 'maps_regeocode') return result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const rec = result as Record<string, unknown>;
  const list = rec.results ?? rec.return ?? rec.geocodes;
  const first = Array.isArray(list) ? list[0] : list;
  if (!first || typeof first !== 'object' || Array.isArray(first)) return result;
  return { ...(first as Record<string, unknown>), results: list };
}

export function normalizeAmapInvokeArgs(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const name = amapBareName(toolName);
  const next = { ...args };
  const locKeys =
    name === 'maps_around_search' || name === 'maps_regeocode'
      ? ['location']
      : name.includes('direction') || name === 'maps_distance'
        ? ['origin', 'destination', 'origins']
        : [];
  for (const key of locKeys) {
    if (!(key in next)) continue;
    const hit = extractAmapLocation(next[key]);
    if (hit) next[key] = hit;
  }
  if (name === 'maps_around_search') {
    const hit = extractAmapLocation(next.location) ?? extractAmapLocation(next);
    if (hit) next.location = hit;
    if (next.radius != null && typeof next.radius !== 'string') next.radius = String(next.radius);
    const keywords = next.keywords ?? next.keyword ?? next.query ?? next.types;
    if (keywords != null && keywords !== '') next.keywords = String(keywords);
  }
  return next;
}
// AIGC END
