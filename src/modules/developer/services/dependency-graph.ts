/** Deterministic cycle detection over resolved artifact identities. Unresolved
 * portable coordinates are handled by mapping validation; only resolved IDs
 * form runtime edges. */
export function findArtifactDependencyCycles(artifacts: Array<{ artifactId: string; dependencies: Array<{ targetArtifactId?: string | null }> }>): string[][] {
  const graph = new Map(artifacts.map((artifact) => [artifact.artifactId, artifact.dependencies.map((dependency) => dependency.targetArtifactId).filter((id): id is string => Boolean(id))]));
  const visited = new Set<string>(), stack = new Set<string>(), cycles: string[][] = [];
  const visit = (id: string, path: string[]) => {
    if (stack.has(id)) { const start = path.indexOf(id); cycles.push(path.slice(start)); return; }
    if (visited.has(id)) return;
    visited.add(id); stack.add(id);
    for (const target of graph.get(id) ?? []) if (graph.has(target)) visit(target, [...path, target]);
    stack.delete(id);
  };
  [...graph.keys()].sort().forEach((id) => visit(id, [id]));
  return [...new Map(cycles.map((cycle) => [cycle.join("->"), cycle])).values()];
}
