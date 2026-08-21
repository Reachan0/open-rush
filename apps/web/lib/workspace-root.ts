// AIGC START
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SANDBOX_WORKSPACE_PATH = '/home/user/workspace';
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/;

function findMonorepoRoot(startDir: string = process.cwd()): string {
  let currentDir = startDir;
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(join(currentDir, 'pnpm-workspace.yaml')) ||
      existsSync(join(currentDir, 'turbo.json'))
    ) {
      return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return dirname(process.cwd());
}

function resolveDefaultWorkspacePath(): string {
  if (existsSync(dirname(SANDBOX_WORKSPACE_PATH))) {
    return SANDBOX_WORKSPACE_PATH;
  }
  return join(dirname(findMonorepoRoot()), 'workspace');
}

export function getWorkspacePath(): string {
  const workspacePath = process.env.WORKSPACE_PATH ?? resolveDefaultWorkspacePath();
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

export function validateProjectId(projectId: string): void {
  if (!projectId || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error(
      `[Workspace] Invalid projectId: "${projectId}". Only alphanumeric, underscore, hyphen, and dot are allowed.`
    );
  }
}

export function ensureProjectDir(projectId: string): string {
  validateProjectId(projectId);
  const projectPath = join(getWorkspacePath(), projectId);
  mkdirSync(projectPath, { recursive: true });
  return projectPath;
}
// AIGC END
