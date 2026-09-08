// AIGC START
export type ReliabilityStatus =
  | 'ok'
  | 'failed'
  | 'degraded'
  | 'human_required'
  | 'cancelled'
  | 'pending';

export interface ReliabilityToolResult {
  status: ReliabilityStatus;
  data?: unknown;
  errorClass?: string | null;
  incidentId?: string | null;
  operationId?: string | null;
  attempts?: number;
  restartAttempts?: number;
  dependencyRecovered?: boolean;
  artifactVerified?: boolean | null;
}
// AIGC END
