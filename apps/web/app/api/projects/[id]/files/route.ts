// AIGC START
import { apiError, apiSuccess, requireAuth, verifyProjectAccess } from '@/lib/api-utils';
import { listWorkspaceTree, readWorkspaceFile, WorkspacePathError } from '@/lib/workspace-files';
import { ensureProjectDir, validateProjectId } from '@/lib/workspace-root';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const projectRoot = ensureProjectDir(id);
  const url = new URL(request.url);
  const relPath = url.searchParams.get('path');

  try {
    if (relPath) {
      const file = readWorkspaceFile(projectRoot, relPath);
      return apiSuccess(file);
    }
    return apiSuccess({ tree: listWorkspaceTree(projectRoot) });
  } catch (err) {
    if (err instanceof WorkspacePathError) {
      return apiError(400, 'VALIDATION_ERROR', err.message);
    }
    throw err;
  }
}
// AIGC END
