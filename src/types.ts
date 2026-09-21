/**
 * Mycelium Core Types
 *
 * Based on Mycelium v0.2 specification.
 * Content-addressed hypergraph for persistent understanding.
 */

/** 52-character lowercase base32 hash (SHA-256) */
export type Hash = string & { readonly __hash: unique symbol };

/** ISO-8601 timestamp string */
export type Timestamp = string;

/** Agent identifier */
export type AgentId = string;

// =============================================================================
// Symbol - The atomic hook
// =============================================================================

/**
 * A symbol is the atomic unit. Meaning is constituted by participation in edges.
 *
 * Identity: Hash(canonical(sym without :meta))
 * Meta does not affect identity - the hook is the identity, not provenance.
 */
export interface Sym {
  readonly _type: 'sym';
  readonly v: 1;

  /** Lexical representation */
  readonly lex: string;

  /** Namespace (e.g., "en", "chem", "code") */
  readonly ns: string;

  /** Optional metadata (excluded from hash) */
  readonly meta?: {
    readonly createdBy?: AgentId;
    readonly createdAt?: Timestamp;
  };
}

// =============================================================================
// Pin - Role-based reference in hyperedge
// =============================================================================

/**
 * A pin binds a role to a reference (symbol or another edge).
 * Enables recursive structure - edges can reference edges.
 */
export interface Pin {
  /** Role symbol hash (e.g., "subject", "object", "instrument") */
  readonly role: Hash;

  /** Reference to symbol OR edge hash */
  readonly ref: Hash;
}

// =============================================================================
// Epistemic - Confidence and polarity metadata
// =============================================================================

export interface Epistemic {
  /** Confidence level 0-1 as string for deterministic serialization */
  readonly confidence: string;

  /** 1 = assertion, 0 = neutral, -1 = denial */
  readonly polarity: 1 | 0 | -1;

  /** Salience level 0-1 as string */
  readonly salience?: string;
}

// =============================================================================
// Conditions - Frame constraints
// =============================================================================

export interface Conditions {
  /** Context hashes where this edge is valid */
  readonly requiresCtx?: readonly Hash[];

  /** Context hashes where this edge breaks */
  readonly breaksIf?: readonly Hash[];
}

// =============================================================================
// Provenance - Who, when, how, from what
// =============================================================================

export interface Provenance {
  readonly by: AgentId;
  readonly at: Timestamp;
  readonly method?: string;
  readonly sources?: readonly Hash[];
}

// =============================================================================
// Edge - The unit of meaning
// =============================================================================

/**
 * A hyperedge binds multiple participants with explicit roles.
 * The meaning IS the binding, not a property of nodes.
 *
 * Identity: Hash(canonical(edge without :meta))
 */
export interface Edge {
  readonly _type: 'edge';
  readonly v: 1;

  /** Quality symbol hash - the relation type */
  readonly q: Hash;

  /** Participants with explicit roles */
  readonly pins: readonly Pin[];

  /** Epistemic status */
  readonly epistemic: Epistemic;

  /** Frame constraints */
  readonly conditions?: Conditions;

  /** Provenance */
  readonly provenance: Provenance;

  /** Optional metadata (excluded from hash) */
  readonly meta?: {
    readonly tags?: readonly string[];
  };
}

// =============================================================================
// Activation - CRDT add tag
// =============================================================================

/**
 * An activation makes an edge active in a context.
 * This is the CRDT "add" operation.
 *
 * Identity: Hash(canonical(act without :at))
 * Timestamp excluded from identity to allow multiple activations.
 */
export interface Activation {
  readonly _type: 'act';
  readonly v: 1;

  /** Edge being activated */
  readonly edge: Hash;

  /** Who activated it */
  readonly by: AgentId;

  /** Unique nonce for this activation */
  readonly nonce: string;

  /** When (excluded from identity) */
  readonly at: Timestamp;
}

// =============================================================================
// Context - Worldview snapshot (OR-Set CRDT)
// =============================================================================

/**
 * A context is a worldview snapshot - what's active from this perspective.
 * State-based OR-Set CRDT over activations.
 *
 * Effective edges: (local ∪ inherited) \ (removes ∪ excluded)
 */
export interface Context {
  readonly _type: 'ctx';
  readonly v: 1;

  /** Lineage - previous context versions */
  readonly parents?: readonly Hash[];

  /** Activation IDs added (sorted) */
  readonly adds: readonly Hash[];

  /** Activation IDs removed/tombstoned (sorted) */
  readonly removes: readonly Hash[];

  /** Context IDs to inherit edges from */
  readonly inherits?: readonly Hash[];

  /** Context IDs to exclude edges from */
  readonly excludes?: readonly Hash[];

  /** Optional metadata */
  readonly meta?: {
    readonly label?: string;
    readonly by?: AgentId;
    readonly at?: Timestamp;
  };
}

// =============================================================================
// Step - Single step in understanding trajectory
// =============================================================================

export interface Step {
  /** Edge activated at this step */
  readonly edge: Hash;

  /** How central this step was (0-1) */
  readonly salience: string;

  /** Symbols that were foregrounded */
  readonly attention?: readonly Hash[];

  /** What clicked at this step */
  readonly insight?: string;
}

// =============================================================================
// Tension - Conflict between claims
// =============================================================================

export interface Tension {
  /** Edge hashes that conflict */
  readonly claims: readonly Hash[];

  /** Edge that resolves the conflict (if resolved) */
  readonly resolution?: Hash;

  /** Explanation */
  readonly note?: string;
}

// =============================================================================
// Path - Trajectory of understanding
// =============================================================================

/**
 * A path preserves how understanding unfolded.
 * Not just what was understood, but the sequence of recognitions.
 */
export interface Path {
  readonly _type: 'path';
  readonly v: 1;

  /** The question this path answers */
  readonly question: string;

  /** Context this path exists in */
  readonly ctx: Hash;

  /** Steps in order of recognition */
  readonly steps: readonly Step[];

  /** Tensions encountered */
  readonly tensions?: {
    readonly resolved?: readonly Tension[];
    readonly open?: readonly Tension[];
  };

  /** Provenance */
  readonly provenance: Provenance;
}

// =============================================================================
// Fragment - Bundle for exchange
// =============================================================================

/**
 * A fragment bundles objects for exchange when receiver can't fetch by hash.
 * Self-contained - receiver can validate and integrate without network.
 */
export interface Fragment {
  readonly _type: 'fragment';
  readonly v: 1;

  /** Root hashes - entry points */
  readonly roots: readonly Hash[];

  /** All objects needed to resolve roots */
  readonly objects: ReadonlyMap<Hash, MyceliumObject>;

  /** Context this fragment belongs to */
  readonly ctx?: Hash;

  /** Request for related information */
  readonly request?: {
    readonly kind: string;
    readonly about?: readonly Hash[];
  };

  /** Provenance */
  readonly provenance: Provenance;

  /** Optional signature */
  readonly sig?: string;
}

// =============================================================================
// Union type for all objects
// =============================================================================

export type MyceliumObject = Sym | Edge | Activation | Context | Path | Fragment;

// =============================================================================
// Type guards
// =============================================================================

export function isSym(obj: MyceliumObject): obj is Sym {
  return obj._type === 'sym';
}

export function isEdge(obj: MyceliumObject): obj is Edge {
  return obj._type === 'edge';
}

export function isActivation(obj: MyceliumObject): obj is Activation {
  return obj._type === 'act';
}

export function isContext(obj: MyceliumObject): obj is Context {
  return obj._type === 'ctx';
}

export function isPath(obj: MyceliumObject): obj is Path {
  return obj._type === 'path';
}

export function isFragment(obj: MyceliumObject): obj is Fragment {
  return obj._type === 'fragment';
}
