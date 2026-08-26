// AIGC START
export const ACTIVE_PROJECT_STORAGE_KEY = 'openrush:active-project-id';
export const ACTIVE_PROJECT_CHANGE_EVENT = 'openrush:active-project-change';

export function readActiveProjectId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
}

export function writeActiveProjectId(id: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, id);
  window.dispatchEvent(new CustomEvent(ACTIVE_PROJECT_CHANGE_EVENT, { detail: id }));
}

export function resolveActiveProjectId(
  projects: Array<{ id: string }>,
  preferredId?: string | null
): string | null {
  if (preferredId && projects.some((project) => project.id === preferredId)) {
    return preferredId;
  }
  const stored = readActiveProjectId();
  if (stored && projects.some((project) => project.id === stored)) {
    return stored;
  }
  return projects[0]?.id ?? null;
}
// AIGC END
