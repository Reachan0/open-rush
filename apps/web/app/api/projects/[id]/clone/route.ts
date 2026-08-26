// AIGC START
import { apiError, apiSuccess, requireAuth, verifyProjectAccess } from '@/lib/api-utils';
import { cloneGitRepoIntoDir, GitCloneError } from '@/lib/git-clone';
import { ensureProjectDir, validateProjectId } from '@/lib/workspace-root';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;
  try {
    validateProjectId(id);
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid project id');
  }

  if (!(await verifyProjectAccess(id, userId))) {
    return apiError(403, 'FORBIDDEN', 'No access to this project');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }
  const repoUrl =
    body && typeof body === 'object' && 'repoUrl' in body
      ? String((body as { repoUrl?: unknown }).repoUrl ?? '')
      : '';

  const projectRoot = ensureProjectDir(id);
  try {
    const result = await cloneGitRepoIntoDir({ repoUrl, projectRoot });
    return apiSuccess({
      cloned: true,
      mode: result.mode,
      repoName: result.repoName,
      target: result.target,
    });
  } catch (err) {
    if (err instanceof GitCloneError) {
      const status = err.code === 'CONFLICT' ? 409 : err.code === 'TIMEOUT' ? 504 : 400;
      return apiError(status, err.code, err.message);
    }
    throw err;
  }
}
// AIGC END
