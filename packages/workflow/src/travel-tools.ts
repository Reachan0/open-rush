// AIGC START
import { createToolInvoker, type RegisteredTool } from './tools.js';
import { type JsonValue, jsonValue } from './types.js';

export const TRAVEL_EXCLUDED = '过山车';

export interface TravelPlace {
  name: string;
  kind: string;
}

function cityFromIntent(args: Record<string, unknown>): string {
  const query = String(args.query ?? args.city ?? args.text ?? '');
  if (query.includes('杭州')) return '杭州';
  if (query.includes('北京')) return '北京';
  return '上海';
}

function namesFrom(value: unknown): string[] {
  if (value == null || value === '') return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => namesFrom(item));
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (typeof rec.name === 'string') return [rec.name];
    for (const key of ['places', 'options', 'items', 'sights', 'foods', 'hotels', 'transit']) {
      if (key in rec) return namesFrom(rec[key]);
    }
  }
  return [];
}

function cityFromArgs(args: Record<string, unknown>): string {
  if (typeof args.city === 'string' && args.city.trim()) return args.city;
  for (const value of Object.values(args)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const city = (value as { city?: unknown }).city;
      if (typeof city === 'string' && city.trim()) return city;
    }
  }
  return '';
}

export const travelToolDefs: RegisteredTool[] = [
  {
    name: 'geo.locate',
    description:
      'Resolve the user city from a free-text query. Input { query }. Output { city, lat, lng }.',
    execute: (args) =>
      jsonValue({
        city: cityFromIntent(args),
        lat: 31.23,
        lng: 121.47,
      }),
  },
  {
    name: 'travel.search',
    description:
      'Recommend nearby sights. Input { city }. Output { city, places: [{ name, kind }] }.',
    execute: (args) => {
      const city = String(args.city ?? '上海');
      const places: TravelPlace[] = [
        { name: `${city}外滩步道`, kind: 'sight' },
        { name: `${city}植物园`, kind: 'sight' },
        { name: TRAVEL_EXCLUDED, kind: 'sight' },
      ];
      return jsonValue({ city, places });
    },
  },
  {
    name: 'food.search',
    description:
      'Recommend nearby food. Input { city }. Output { city, places: [{ name, kind }] }.',
    execute: (args) => {
      const city = String(args.city ?? '上海');
      return jsonValue({
        city,
        places: [
          { name: `${city}本帮菜`, kind: 'food' },
          { name: `${city}点心铺`, kind: 'food' },
        ],
      });
    },
  },
  {
    name: 'hotel.search',
    description:
      'Recommend nearby hotels. Input { city }. Output { city, places: [{ name, kind }] }.',
    execute: (args) => {
      const city = String(args.city ?? '上海');
      return jsonValue({
        city,
        places: [{ name: `${city}家庭酒店`, kind: 'hotel' }],
      });
    },
  },
  {
    name: 'transit.search',
    description:
      'Recommend transit options. Input { city }. Output { city, options: [{ name, kind }] }.',
    execute: (args) => {
      const city = String(args.city ?? '上海');
      return jsonValue({
        city,
        options: [{ name: `${city}地铁+步行`, kind: 'transit' }],
      });
    },
  },
  {
    name: 'memory.filter',
    description:
      'Drop places that conflict with user memory / taboos. Input { places } (array). Output the filtered array.',
    execute: (args) => {
      const payload = args as { places?: TravelPlace[]; items?: TravelPlace[] };
      const places = payload.places ?? payload.items ?? [];
      return jsonValue(places.filter((p) => p.name !== TRAVEL_EXCLUDED));
    },
  },
  {
    name: 'article.compose',
    description:
      'Write the final assistant chat reply for a trip. Input { city, sights, foods, hotels, transit } — pass whole previous node outputs (objects or arrays), not guessed nested fields.',
    execute: (args) => {
      const city = cityFromArgs(args);
      const sights =
        namesFrom(
          args.sights ?? args.places ?? args.search_sights ?? args.filter_memory ?? args.filter
        ).join('、') || '周边景点';
      const foods = namesFrom(args.foods ?? args.food ?? args.search_food).join('、') || '当地美食';
      const hotels =
        namesFrom(args.hotels ?? args.hotel ?? args.search_hotels).join('、') || '合适住宿';
      const transit = namesFrom(args.transit ?? args.search_transit).join('、') || '公共交通';
      return `这周末在${city}可以带全家去${sights}转转，吃饭可以试试${foods}，住宿看${hotels}，出行用${transit}会比较省事。`;
    },
  },
];

export function createTravelToolInvoker(overrides?: {
  delayMs?: number;
  onCall?: (name: string) => void;
}) {
  const delayMs = overrides?.delayMs ?? 0;
  const wrapped = travelToolDefs.map((tool) => ({
    ...tool,
    execute: async (args: Record<string, unknown>, signal?: AbortSignal) => {
      overrides?.onCall?.(tool.name);
      if (delayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error('aborted'));
          });
        });
      }
      return tool.execute(args, signal);
    },
  }));
  return createToolInvoker(wrapped);
}

export function extractIntentFields(intent: string): Record<string, JsonValue> {
  return {
    text: intent,
    city: intent.includes('杭州') ? '杭州' : intent.includes('北京') ? '北京' : '上海',
  };
}
// AIGC END
