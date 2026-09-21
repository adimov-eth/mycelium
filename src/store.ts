/**
 * Content-Addressed Store
 *
 * Stores Mycelium objects by their content hash.
 * Supports both filesystem (global/local) and in-memory storage.
 */

import { mkdir, readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import type { Hash, MyceliumObject } from './types.js';
import { hashObject, isValidHash } from './hash.js';
import { canonical } from './canonical.js';

// =============================================================================
// Store Interface
// =============================================================================

export interface Store {
  /** Get object by hash, returns undefined if not found */
  get(hash: Hash): Promise<MyceliumObject | undefined>;

  /** Store object, returns its hash */
  put(obj: MyceliumObject): Promise<Hash>;

  /** Check if object exists */
  has(hash: Hash): Promise<boolean>;

  /** List all hashes (may be expensive) */
  list(): Promise<Hash[]>;
}

// =============================================================================
// In-Memory Store
// =============================================================================

export class MemoryStore implements Store {
  private objects = new Map<Hash, MyceliumObject>();

  async get(hash: Hash): Promise<MyceliumObject | undefined> {
    return this.objects.get(hash);
  }

  async put(obj: MyceliumObject): Promise<Hash> {
    const hash = hashObject(obj);
    this.objects.set(hash, obj);
    return hash;
  }

  async has(hash: Hash): Promise<boolean> {
    return this.objects.has(hash);
  }

  async list(): Promise<Hash[]> {
    return Array.from(this.objects.keys());
  }

  /** Get count of stored objects */
  get size(): number {
    return this.objects.size;
  }

  /** Clear all objects */
  clear(): void {
    this.objects.clear();
  }
}

// =============================================================================
// Filesystem Store
// =============================================================================

/**
 * Layout:
 *   {root}/objects/{hash[0:2]}/{hash} → canonical S-expression
 */
export class FileStore implements Store {
  constructor(private readonly root: string) {}

  private objectPath(hash: Hash): string {
    const prefix = hash.slice(0, 2);
    return join(this.root, 'objects', prefix, hash);
  }

  async get(hash: Hash): Promise<MyceliumObject | undefined> {
    const path = this.objectPath(hash);
    try {
      const content = await readFile(path, 'utf8');
      // Parse S-expression back to object
      // For now, we store JSON alongside for easy reconstruction
      const jsonPath = path + '.json';
      const json = await readFile(jsonPath, 'utf8');
      return JSON.parse(json) as MyceliumObject;
    } catch {
      return undefined;
    }
  }

  async put(obj: MyceliumObject): Promise<Hash> {
    const hash = hashObject(obj);
    const path = this.objectPath(hash);

    // Ensure directory exists
    await mkdir(dirname(path), { recursive: true });

    // Store both canonical form (for verification) and JSON (for reconstruction)
    const canonicalForm = canonical(obj);
    await writeFile(path, canonicalForm, 'utf8');
    await writeFile(path + '.json', JSON.stringify(obj, null, 2), 'utf8');

    return hash;
  }

  async has(hash: Hash): Promise<boolean> {
    const path = this.objectPath(hash);
    return existsSync(path);
  }

  async list(): Promise<Hash[]> {
    const objectsDir = join(this.root, 'objects');
    const hashes: Hash[] = [];

    try {
      const prefixes = await readdir(objectsDir);
      for (const prefix of prefixes) {
        const prefixDir = join(objectsDir, prefix);
        const stats = await stat(prefixDir);
        if (stats.isDirectory()) {
          const files = await readdir(prefixDir);
          for (const file of files) {
            // Skip .json files, only count the main files
            if (!file.endsWith('.json') && isValidHash(file)) {
              hashes.push(file as Hash);
            }
          }
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    return hashes;
  }

  /** Ensure the store directory structure exists */
  async init(): Promise<void> {
    await mkdir(join(this.root, 'objects'), { recursive: true });
  }
}

// =============================================================================
// Layered Store (local over global)
// =============================================================================

/**
 * A store that reads from multiple layers, writes to the first.
 * Useful for local/.context over global/~/.foundation
 */
export class LayeredStore implements Store {
  constructor(private readonly layers: Store[]) {
    if (layers.length === 0) {
      throw new Error('LayeredStore requires at least one layer');
    }
  }

  async get(hash: Hash): Promise<MyceliumObject | undefined> {
    for (const layer of this.layers) {
      const obj = await layer.get(hash);
      if (obj !== undefined) {
        return obj;
      }
    }
    return undefined;
  }

  async put(obj: MyceliumObject): Promise<Hash> {
    // Write to first (local) layer only
    return this.layers[0].put(obj);
  }

  async has(hash: Hash): Promise<boolean> {
    for (const layer of this.layers) {
      if (await layer.has(hash)) {
        return true;
      }
    }
    return false;
  }

  async list(): Promise<Hash[]> {
    const all = new Set<Hash>();
    for (const layer of this.layers) {
      const hashes = await layer.list();
      for (const h of hashes) {
        all.add(h);
      }
    }
    return Array.from(all);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a store from a path.
 * If path is undefined, returns an in-memory store.
 */
export function createStore(path?: string): Store {
  if (!path) {
    return new MemoryStore();
  }
  return new FileStore(path);
}

/**
 * Create the default global store at ~/.foundation/mycelium
 */
export function createGlobalStore(): FileStore {
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  return new FileStore(join(home, '.foundation', 'mycelium'));
}

/**
 * Create a local store at .context/ in the given project root
 */
export function createLocalStore(projectRoot: string): FileStore {
  return new FileStore(join(projectRoot, '.context'));
}
