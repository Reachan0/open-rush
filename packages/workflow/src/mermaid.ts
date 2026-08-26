// AIGC START
import type { WorkflowDsl } from './types.js';

function escapeLabel(text: string): string {
  return text.replace(/"/g, '#quot;').replace(/\n/g, ' ');
}

/** Render a Workflow DSL as a Mermaid flowchart (paste into any Mermaid renderer). */
export function workflowToMermaid(dsl: WorkflowDsl): string {
  const lines = ['flowchart TD'];
  for (const node of dsl.nodes) {
    const flags = [node.if ? 'if' : '', node.foreach ? 'foreach' : ''].filter(Boolean).join(' ');
    const label = flags ? `${node.id}\\n${node.tool}\\n${flags}` : `${node.id}\\n${node.tool}`;
    lines.push(`  ${node.id}["${escapeLabel(label)}"]`);
  }
  for (const node of dsl.nodes) {
    const deps = node.dependsOn ?? [];
    if (deps.length === 0) continue;
    for (const dep of deps) {
      if (node.if) {
        lines.push(`  ${dep} -->|"if"| ${node.id}`);
      } else {
        lines.push(`  ${dep} --> ${node.id}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
// AIGC END
