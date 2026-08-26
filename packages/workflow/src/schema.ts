// AIGC START
import { z } from 'zod';
import type { WorkflowDsl } from './types.js';

const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue)])
);

export const WorkflowNodeSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'node id must be a JS-like identifier'),
  tool: z.string().min(1),
  input: z.record(jsonValue).optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
  if: z.string().min(1).optional(),
  foreach: z.string().min(1).optional(),
});

export const WorkflowDslSchema = z.object({
  version: z.literal('1'),
  name: z.string().min(1).optional(),
  nodes: z.array(WorkflowNodeSchema).min(1),
});

/** JSON Schema for F1 validation / LLM structured output. */
export const WORKFLOW_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://open-rush.local/schema/workflow-dsl-v1.json',
  title: 'OpenRush Workflow DSL v1',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'nodes'],
  properties: {
    version: { const: '1', type: 'string' },
    name: { type: 'string', minLength: 1 },
    nodes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'tool'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' },
          tool: { type: 'string', minLength: 1 },
          input: { type: 'object' },
          dependsOn: { type: 'array', items: { type: 'string', minLength: 1 } },
          if: { type: 'string', minLength: 1 },
          foreach: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const;

export function parseWorkflowDsl(input: unknown): WorkflowDsl {
  return WorkflowDslSchema.parse(input) as WorkflowDsl;
}

export function safeParseWorkflowDsl(input: unknown) {
  return WorkflowDslSchema.safeParse(input);
}
// AIGC END
