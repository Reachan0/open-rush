// AIGC START
import type { WorkflowDsl } from './types.js';

export const WEEKEND_TRIP_INTENT = '我周六想带全家出去玩，帮我推荐附近好玩的地方';

export function weekendTripDsl(): WorkflowDsl {
  return {
    version: '1',
    name: 'weekend-family-trip',
    nodes: [
      {
        id: 'locate',
        tool: 'geo.locate',
        input: { query: '{{intent.text}}' },
      },
      {
        id: 'sights',
        tool: 'travel.search',
        input: { city: '{{nodes.locate.output.city}}' },
        dependsOn: ['locate'],
      },
      {
        id: 'foods',
        tool: 'food.search',
        input: { city: '{{nodes.locate.output.city}}' },
        dependsOn: ['locate'],
      },
      {
        id: 'hotels',
        tool: 'hotel.search',
        input: { city: '{{nodes.locate.output.city}}' },
        dependsOn: ['locate'],
      },
      {
        id: 'transit',
        tool: 'transit.search',
        input: { city: '{{nodes.locate.output.city}}' },
        dependsOn: ['locate'],
      },
      {
        id: 'filter',
        tool: 'memory.filter',
        input: { places: '{{nodes.sights.output.places}}' },
        dependsOn: ['sights'],
        if: '{{nodes.sights.output.places.length}} > 0',
      },
      {
        id: 'article',
        tool: 'article.compose',
        input: {
          city: '{{nodes.locate.output.city}}',
          sights: '{{nodes.filter.output}}',
          foods: '{{nodes.foods.output}}',
          hotels: '{{nodes.hotels.output}}',
          transit: '{{nodes.transit.output}}',
        },
        dependsOn: ['filter', 'foods', 'hotels', 'transit'],
      },
    ],
  };
}

type LoopPrev = Record<string, unknown>;

export const AGENT_LOOP_TRAVEL_STEPS: Array<{
  tool: string;
  args: (intent: string, prev: LoopPrev) => Record<string, unknown>;
}> = [
  { tool: 'geo.locate', args: (intent) => ({ query: intent }) },
  {
    tool: 'travel.search',
    args: (_intent, prev) => ({
      city: (prev.locate as { city: string }).city,
    }),
  },
  {
    tool: 'food.search',
    args: (_intent: string, prev: Record<string, unknown>) => ({
      city: (prev.locate as { city: string }).city,
    }),
  },
  {
    tool: 'hotel.search',
    args: (_intent: string, prev: Record<string, unknown>) => ({
      city: (prev.locate as { city: string }).city,
    }),
  },
  {
    tool: 'transit.search',
    args: (_intent: string, prev: Record<string, unknown>) => ({
      city: (prev.locate as { city: string }).city,
    }),
  },
  {
    tool: 'memory.filter',
    args: (_intent: string, prev: Record<string, unknown>) => ({
      places: (prev.sights as { places: unknown }).places,
    }),
  },
  {
    tool: 'article.compose',
    args: (_intent: string, prev: Record<string, unknown>) => ({
      city: (prev.locate as { city: string }).city,
      sights: prev.filter,
      foods: prev.foods,
      hotels: prev.hotels,
      transit: prev.transit,
    }),
  },
];
// AIGC END
