/**
 * Context Resolution
 *
 * OR-Set CRDT semantics for worldview management.
 * Contexts can inherit, exclude, add, and remove activations.
 */

import type { Hash, Context, Activation, Edge } from './types.js';
import type { Store } from './store.js';

// =============================================================================
// Context Resolution
// =============================================================================

/**
 * Resolve effective activations for a context.
 *
 * Algorithm:
 *   1. local_active = adds \ removes
 *   2. inherited_active = union of resolve(parent) for each inherited context
 *   3. excluded_active = union of resolve(parent) for each excluded context
 *   4. return (local_active ∪ inherited_active) \ excluded_active
 */
export async function resolveActivations(
  ctx: Context,
  store: Store,
  visited = new Set<Hash>()
): Promise<Set<Hash>> {
  // Prevent infinite recursion on cycles
  const ctxHash = await hashContext(ctx, store);
  if (visited.has(ctxHash)) {
    return new Set();
  }
  visited.add(ctxHash);

  // Local active = adds \ removes
  const localActive = new Set<Hash>();
  for (const addHash of ctx.adds) {
    if (!ctx.removes.includes(addHash)) {
      localActive.add(addHash);
    }
  }

  // Inherited active
  const inheritedActive = new Set<Hash>();
  if (ctx.inherits) {
    for (const inheritHash of ctx.inherits) {
      const inheritCtx = await store.get(inheritHash);
      if (inheritCtx && inheritCtx._type === 'ctx') {
        const inherited = await resolveActivations(inheritCtx, store, visited);
        for (const h of inherited) {
          inheritedActive.add(h);
        }
      }
    }
  }

  // Excluded active
  const excludedActive = new Set<Hash>();
  if (ctx.excludes) {
    for (const excludeHash of ctx.excludes) {
      const excludeCtx = await store.get(excludeHash);
      if (excludeCtx && excludeCtx._type === 'ctx') {
        const excluded = await resolveActivations(excludeCtx, store, visited);
        for (const h of excluded) {
          excludedActive.add(h);
        }
      }
    }
  }

  // Combine: (local ∪ inherited) \ excluded
  const result = new Set<Hash>();
  for (const h of localActive) {
    if (!excludedActive.has(h)) {
      result.add(h);
    }
  }
  for (const h of inheritedActive) {
    if (!excludedActive.has(h)) {
      result.add(h);
    }
  }

  return result;
}

/**
 * Resolve effective edges for a context.
 * Returns the edges referenced by active activations.
 */
export async function resolveEdges(ctx: Context, store: Store): Promise<Edge[]> {
  const activationHashes = await resolveActivations(ctx, store);
  const edges: Edge[] = [];

  for (const actHash of activationHashes) {
    const activation = await store.get(actHash);
    if (activation && activation._type === 'act') {
      const edge = await store.get(activation.edge);
      if (edge && edge._type === 'edge') {
        edges.push(edge);
      }
    }
  }

  return edges;
}

// =============================================================================
// Context Merge (CRDT)
// =============================================================================

/**
 * Merge two contexts (OR-Set semantics).
 *
 * Properties:
 *   - Commutative: merge(A, B) = merge(B, A)
 *   - Associative: merge(merge(A, B), C) = merge(A, merge(B, C))
 *   - Idempotent: merge(A, A) = A
 */
export function mergeContexts(c1: Context, c2: Context): Context {
  // Union all sets, sort for determinism
  const adds = [...new Set([...c1.adds, ...c2.adds])].sort();
  const removes = [...new Set([...c1.removes, ...c2.removes])].sort();
  const parents = [...new Set([...(c1.parents || []), ...(c2.parents || [])])].sort();
  const inherits = [...new Set([...(c1.inherits || []), ...(c2.inherits || [])])].sort();
  const excludes = [...new Set([...(c1.excludes || []), ...(c2.excludes || [])])].sort();

  return {
    _type: 'ctx',
    v: 1,
    adds,
    removes,
    parents: parents.length > 0 ? parents : undefined,
    inherits: inherits.length > 0 ? inherits : undefined,
    excludes: excludes.length > 0 ? excludes : undefined,
  };
}

// =============================================================================
// Context Operations
// =============================================================================

/**
 * Create a new empty context
 */
export function emptyContext(meta?: Context['meta']): Context {
  return {
    _type: 'ctx',
    v: 1,
    adds: [],
    removes: [],
    meta,
  };
}

/**
 * Create a new context with an activation added
 */
export function addActivation(ctx: Context, activationHash: Hash): Context {
  if (ctx.adds.includes(activationHash)) {
    return ctx; // Already added
  }

  return {
    ...ctx,
    adds: [...ctx.adds, activationHash].sort(),
    // If it was removed, keep it in removes (OR-Set: add wins for new items)
  };
}

/**
 * Create a new context with an activation removed
 */
export function removeActivation(ctx: Context, activationHash: Hash): Context {
  if (ctx.removes.includes(activationHash)) {
    return ctx; // Already removed
  }

  return {
    ...ctx,
    removes: [...ctx.removes, activationHash].sort(),
  };
}

/**
 * Create a new context that inherits from another
 */
export function inheritFrom(ctx: Context, parentHash: Hash): Context {
  if (ctx.inherits?.includes(parentHash)) {
    return ctx; // Already inheriting
  }

  return {
    ...ctx,
    inherits: [...(ctx.inherits || []), parentHash].sort(),
  };
}

/**
 * Create a new context that excludes another
 */
export function excludeFrom(ctx: Context, excludeHash: Hash): Context {
  if (ctx.excludes?.includes(excludeHash)) {
    return ctx; // Already excluding
  }

  return {
    ...ctx,
    excludes: [...(ctx.excludes || []), excludeHash].sort(),
  };
}

// =============================================================================
// Helper
// =============================================================================

import { hashObject } from './hash.js';

async function hashContext(ctx: Context, _store: Store): Promise<Hash> {
  return hashObject(ctx);
}
