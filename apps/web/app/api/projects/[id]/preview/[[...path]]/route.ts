// AIGC START
import { apiError, requireAuth, verifyProjectAccess } from '@/lib/api-utils';
import {
  listWorkspaceTree,
  readWorkspacePreviewBytes,
  WorkspacePathError,
} from '@/lib/workspace-files';
import { ensureProjectDir, validateProjectId } from '@/lib/workspace-root';
import { findPreviewHtmlPath } from '@/lib/workspace-types';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; path?: string[] }> }
) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id, path: pathParts } = await params;
  try {
    validateProjectId(id);
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid project id');
  }

  if (!(await verifyProjectAccess(id, userId))) {
    return apiError(403, 'FORBIDDEN', 'No access to this project');
  }

  const projectRoot = ensureProjectDir(id);
  const requested = (pathParts ?? []).join('/');
  const relPath = requested || findPreviewHtmlPath(listWorkspaceTree(projectRoot)) || 'index.html';

  try {
    const file = readWorkspacePreviewBytes(projectRoot, relPath);
    const body = new Uint8Array(new ArrayBuffer(file.body.byteLength));
    body.set(file.body);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof WorkspacePathError) {
      return apiError(404, 'NOT_FOUND', err.message);
    }
    throw err;
  }
}
// AIGC END
