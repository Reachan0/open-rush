export function resolveAo04ExperimentId(
  runId: string,
  env: Record<string, string | undefined> = process.env
): string {
  if (env.AO04_SERVICE_DEMO === '1') return 'ao04-demo-local';
  return env.AO04_EXPERIMENT_ID ?? `ao04-${runId}`;
}
