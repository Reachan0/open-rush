// AIGC START
export type WorkspaceNode = {
  type: 'file' | 'dir';
  name: string;
  path: string;
  children?: WorkspaceNode[];
};

export function findPreviewHtmlPath(nodes: WorkspaceNode[]): string | null {
  const rootIndex = nodes.find(
    (node) => node.type === 'file' && node.name.toLowerCase() === 'index.html'
  );
  if (rootIndex) return rootIndex.path;

  const stack = [...nodes];
  let firstHtml: string | null = null;
  while (stack.length > 0) {
    const node = stack.shift();
    if (!node) break;
    if (node.type === 'file' && node.name.toLowerCase() === 'index.html') {
      return node.path;
    }
    if (node.type === 'file' && node.name.toLowerCase().endsWith('.html') && !firstHtml) {
      firstHtml = node.path;
    }
    if (node.type === 'dir' && node.children) {
      stack.push(...node.children);
    }
  }
  return firstHtml;
}
// AIGC END
