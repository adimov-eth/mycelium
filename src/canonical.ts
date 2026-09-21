/**
 * CSEXP-1 Canonicalization
 *
 * Deterministic serialization for content-addressing.
 * All objects must serialize identically across implementations.
 */

import type {
  Sym,
  Edge,
  Activation,
  Context,
  Path,
  Fragment,
  MyceliumObject,
  Hash,
} from './types.js';

// =============================================================================
// Canonical print rules (from spec)
// =============================================================================

/**
 * Check if a string can be a simple symbol (unquoted)
 */
function isSimpleSymbol(s: string): boolean {
  if (s.length === 0) return false;
  // Must match [A-Za-z+\-*/<>=!?_:.][A-Za-z0-9+\-*/<>=!?_:.]*
  // and not start with digit
  if (/^[0-9]/.test(s)) return false;
  return /^[A-Za-z+\-*/<>=!?_:.][A-Za-z0-9+\-*/<>=!?_:.]*$/.test(s);
}

/**
 * Escape a string for canonical output
 */
function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Canonicalize a symbol name
 */
function canonicalSymbol(s: string): string {
  if (isSimpleSymbol(s)) {
    return s;
  }
  // Use |...| syntax with escapes
  return `|${s.replace(/\|/g, '\\|').replace(/\\/g, '\\\\')}|`;
}

/**
 * Canonicalize a keyword (:name)
 */
function canonicalKeyword(s: string): string {
  return `:${canonicalSymbol(s)}`;
}

/**
 * Canonicalize a value to S-expression string
 */
function canonicalValue(v: unknown): string {
  if (v === null || v === undefined) {
    return 'nil';
  }

  if (typeof v === 'boolean') {
    return v ? '#t' : '#f';
  }

  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error(`Cannot canonicalize non-finite number: ${v}`);
    }
    if (Number.isInteger(v)) {
      return String(v);
    }
    // Decimals as strings for determinism
    return `"${v}"`;
  }

  if (typeof v === 'string') {
    return `"${escapeString(v)}"`;
  }

  if (Array.isArray(v)) {
    if (v.length === 0) {
      return '()';
    }
    const elements = v.map(canonicalValue);
    return `(${elements.join(' ')})`;
  }

  if (v instanceof Map) {
    const entries = Array.from(v.entries())
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([k, val]) => `(${canonicalValue(k)} ${canonicalValue(val)})`);
    return `(${entries.join(' ')})`;
  }

  if (typeof v === 'object') {
    return canonicalRecord(v as Record<string, unknown>);
  }

  throw new Error(`Cannot canonicalize value of type ${typeof v}`);
}

/**
 * Canonicalize a record (object) with sorted keys
 */
function canonicalRecord(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();

  if (keys.length === 0) {
    return '()';
  }

  const pairs = keys.map((k) => `${canonicalKeyword(k)} ${canonicalValue(obj[k])}`);
  return `(${pairs.join(' ')})`;
}

// =============================================================================
// Object-specific canonicalization (excluding meta fields)
// =============================================================================

/**
 * Canonicalize a Symbol (excluding meta)
 */
export function canonicalSym(sym: Sym): string {
  return `(sym :v ${sym.v} :lex "${escapeString(sym.lex)}" :ns "${escapeString(sym.ns)}")`;
}

/**
 * Canonicalize an Edge (excluding meta)
 */
export function canonicalEdge(edge: Edge): string {
  const parts: string[] = [
    'edge',
    ':v 1',
    `:q ${edge.q}`,
    `:pins (${edge.pins.map((p) => `(pin :ref ${p.ref} :role ${p.role})`).join(' ')})`,
    `:epistemic (:confidence "${edge.epistemic.confidence}" :polarity ${edge.epistemic.polarity}${edge.epistemic.salience ? ` :salience "${edge.epistemic.salience}"` : ''})`,
  ];

  if (edge.conditions) {
    const condParts: string[] = [];
    if (edge.conditions.requiresCtx?.length) {
      condParts.push(`:requires-ctx (${[...edge.conditions.requiresCtx].sort().join(' ')})`);
    }
    if (edge.conditions.breaksIf?.length) {
      condParts.push(`:breaks-if (${[...edge.conditions.breaksIf].sort().join(' ')})`);
    }
    if (condParts.length) {
      parts.push(`:conditions (${condParts.join(' ')})`);
    }
  }

  parts.push(`:provenance (:at "${edge.provenance.at}" :by "${escapeString(edge.provenance.by)}"${edge.provenance.method ? ` :method "${escapeString(edge.provenance.method)}"` : ''}${edge.provenance.sources?.length ? ` :sources (${[...edge.provenance.sources].sort().join(' ')})` : ''})`);

  return `(${parts.join(' ')})`;
}

/**
 * Canonicalize an Activation (excluding at for identity)
 */
export function canonicalActivation(act: Activation): string {
  // Note: :at is excluded from identity hash
  return `(act :v 1 :by "${escapeString(act.by)}" :edge ${act.edge} :nonce "${escapeString(act.nonce)}")`;
}

/**
 * Canonicalize a Context
 */
export function canonicalContext(ctx: Context): string {
  const parts: string[] = [
    'ctx',
    ':v 1',
    `:adds (${[...ctx.adds].sort().join(' ')})`,
    `:removes (${[...ctx.removes].sort().join(' ')})`,
  ];

  if (ctx.parents?.length) {
    parts.push(`:parents (${[...ctx.parents].sort().join(' ')})`);
  }
  if (ctx.inherits?.length) {
    parts.push(`:inherits (${[...ctx.inherits].sort().join(' ')})`);
  }
  if (ctx.excludes?.length) {
    parts.push(`:excludes (${[...ctx.excludes].sort().join(' ')})`);
  }

  return `(${parts.join(' ')})`;
}

/**
 * Canonicalize a Path
 */
export function canonicalPath(path: Path): string {
  const steps = path.steps.map((s) => {
    let step = `(step :edge ${s.edge} :salience "${s.salience}"`;
    if (s.attention?.length) {
      step += ` :attention (${[...s.attention].join(' ')})`;
    }
    if (s.insight) {
      step += ` :insight "${escapeString(s.insight)}"`;
    }
    return step + ')';
  });

  const parts: string[] = [
    'path',
    ':v 1',
    `:ctx ${path.ctx}`,
    `:provenance (:at "${path.provenance.at}" :by "${escapeString(path.provenance.by)}")`,
    `:question "${escapeString(path.question)}"`,
    `:steps (${steps.join(' ')})`,
  ];

  if (path.tensions) {
    const tensionParts: string[] = [];
    if (path.tensions.open?.length) {
      const open = path.tensions.open.map(
        (t) =>
          `(tension :claims (${[...t.claims].sort().join(' ')})${t.note ? ` :note "${escapeString(t.note)}"` : ''})`
      );
      tensionParts.push(`:open (${open.join(' ')})`);
    }
    if (path.tensions.resolved?.length) {
      const resolved = path.tensions.resolved.map(
        (t) =>
          `(tension :claims (${[...t.claims].sort().join(' ')})${t.resolution ? ` :resolution ${t.resolution}` : ''}${t.note ? ` :note "${escapeString(t.note)}"` : ''})`
      );
      tensionParts.push(`:resolved (${resolved.join(' ')})`);
    }
    if (tensionParts.length) {
      parts.push(`:tensions (${tensionParts.join(' ')})`);
    }
  }

  return `(${parts.join(' ')})`;
}

/**
 * Canonicalize any Mycelium object
 */
export function canonical(obj: MyceliumObject): string {
  switch (obj._type) {
    case 'sym':
      return canonicalSym(obj);
    case 'edge':
      return canonicalEdge(obj);
    case 'act':
      return canonicalActivation(obj);
    case 'ctx':
      return canonicalContext(obj);
    case 'path':
      return canonicalPath(obj);
    case 'fragment':
      throw new Error('Fragments are not content-addressed');
    default:
      throw new Error(`Unknown object type: ${(obj as MyceliumObject)._type}`);
  }
}
