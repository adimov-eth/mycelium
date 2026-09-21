/**
 * Mycelium — content-addressed hypergraph.
 */

// Types
export * from './types.js';

// Content addressing
export { canonical } from './canonical.js';
export { sha256base32, hashObject, isValidHash, assertHash } from './hash.js';

// Storage
export {
  type Store,
  MemoryStore,
  FileStore,
  LayeredStore,
  createStore,
  createGlobalStore,
  createLocalStore,
} from './store.js';

// Context resolution
export {
  resolveActivations,
  resolveEdges,
  mergeContexts,
  emptyContext,
  addActivation,
  removeActivation,
  inheritFrom,
  excludeFrom,
} from './context.js';

// Git-backed storage
export {
  GitStore,
  type GitStoreOptions,
  createGitStore,
  createProjectGitStore,
  hydrateFromGit,
} from './git-store.js';

// =============================================================================
// Convenience Builders
// =============================================================================

import type {
  Hash,
  Sym,
  Edge,
  Activation,
  Path,
  Pin,
  Epistemic,
  Provenance,
  Step,
  Tension,
  AgentId,
  Timestamp,
} from './types.js';

/**
 * Create a symbol
 */
export function sym(lex: string, ns: string, meta?: Sym['meta']): Sym {
  return { _type: 'sym', v: 1, lex, ns, meta };
}

/**
 * Create a pin (role-reference binding)
 */
export function pin(role: Hash, ref: Hash): Pin {
  return { role, ref };
}

/**
 * Create epistemic metadata
 */
export function epistemic(
  confidence: number,
  polarity: 1 | 0 | -1 = 1,
  salience?: number
): Epistemic {
  return {
    confidence: confidence.toString(),
    polarity,
    salience: salience?.toString(),
  };
}

/**
 * Create provenance metadata
 */
export function provenance(
  by: AgentId,
  at?: Timestamp,
  method?: string,
  sources?: Hash[]
): Provenance {
  return {
    by,
    at: at || new Date().toISOString(),
    method,
    sources,
  };
}

/**
 * Create an edge (hyperedge binding)
 */
export function edge(
  q: Hash,
  pins: Pin[],
  epistemic: Epistemic,
  provenance: Provenance,
  conditions?: Edge['conditions'],
  meta?: Edge['meta']
): Edge {
  return { _type: 'edge', v: 1, q, pins, epistemic, provenance, conditions, meta };
}

/**
 * Create an activation
 */
export function activation(
  edgeHash: Hash,
  by: AgentId,
  nonce?: string,
  at?: Timestamp
): Activation {
  return {
    _type: 'act',
    v: 1,
    edge: edgeHash,
    by,
    nonce: nonce || crypto.randomUUID(),
    at: at || new Date().toISOString(),
  };
}

/**
 * Create a step in a path
 */
export function step(
  edgeHash: Hash,
  salience: number,
  insight?: string,
  attention?: Hash[]
): Step {
  return {
    edge: edgeHash,
    salience: salience.toString(),
    insight,
    attention,
  };
}

/**
 * Create a tension
 */
export function tension(
  claims: Hash[],
  resolution?: Hash,
  note?: string
): Tension {
  return { claims, resolution, note };
}

/**
 * Create a path (understanding trajectory)
 */
export function path(
  question: string,
  ctx: Hash,
  steps: Step[],
  provenance: Provenance,
  tensions?: Path['tensions']
): Path {
  return { _type: 'path', v: 1, question, ctx, steps, provenance, tensions };
}
