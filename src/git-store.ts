/**
 * Git-Backed Content-Addressed Store
 *
 * Uses git's native object model for hypergraph storage:
 *   - Symbols, Edges, Activations, Paths → git blobs (canonical S-expressions)
 *   - Contexts → git commits (snapshot of active edges)
 *   - Branches → agent worldviews
 *
 * The isomorphism:
 *   Mycelium          Git
 *   ────────────────────────
 *   Object hash    →  blob SHA (content-addressed)
 *   Context        →  commit (snapshot + parents)
 *   Inheritance    →  commit parents
 *   Agent context  →  branch ref
 *
 * This gives us:
 *   - Merkle DAG integrity verification for free
 *   - Distributed sync via git push/pull
 *   - History and time travel via git log/checkout
 *   - Tooling (git log, diff, blame) works on the hypergraph
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, readFile, writeFile, access, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import type { Hash, MyceliumObject, Context, Path } from './types.js';
import { hashObject, isValidHash, sha256base32 } from './hash.js';
import { canonical } from './canonical.js';
import type { Store } from './store.js';

const execFileAsync = promisify(execFile);

// =============================================================================
// Git Hash Conversion
// =============================================================================

/**
 * Our hashes are 52-char base32 (SHA-256).
 * Git uses 40-char hex (SHA-1) or 64-char hex (SHA-256 if enabled).
 *
 * Strategy: Store objects by OUR hash as filename in a git-tracked directory.
 * Git handles the content integrity, we handle the addressing.
 *
 * Alternative: Use git's native hash-object, accept the SHA-1/SHA-256 mismatch.
 * We'd store a mapping file or use the content itself to derive both.
 *
 * Going with: Hybrid approach.
 * - Store canonical S-expr as blob content
 * - Track by our hash in the object path
 * - Let git provide integrity and sync
 */

// =============================================================================
// GitStore Implementation
// =============================================================================

export interface GitStoreOptions {
  /** Path to the git repository root */
  repoPath: string;

  /** Branch name for this agent's context (default: 'main') */
  branch?: string;

  /** Auto-commit on every put (default: false) */
  autoCommit?: boolean;

  /** Remote name for sync (default: 'origin') */
  remote?: string;
}

/**
 * Git-backed content-addressed store.
 *
 * Layout:
 *   {repoPath}/
 *     .git/                    # git internals
 *     objects/
 *       {hash[0:2]}/
 *         {hash}               # canonical S-expression
 *     contexts/
 *       {label}.ctx            # current context state (JSON for easy editing)
 *     HEAD.ctx                 # pointer to active context label
 */
export class GitStore implements Store {
  private repoPath: string;
  private branch: string;
  private autoCommit: boolean;
  private remote: string;
  private initialized = false;

  constructor(options: GitStoreOptions) {
    this.repoPath = options.repoPath;
    this.branch = options.branch ?? 'main';
    this.autoCommit = options.autoCommit ?? false;
    this.remote = options.remote ?? 'origin';
  }

  // ===========================================================================
  // Store Interface
  // ===========================================================================

  async get(hash: Hash): Promise<MyceliumObject | undefined> {
    await this.ensureInit();
    const path = this.objectPath(hash);
    try {
      const content = await readFile(path, 'utf8');
      // We store both canonical (for verification) and JSON (for reconstruction)
      const jsonPath = path + '.json';
      const json = await readFile(jsonPath, 'utf8');
      return JSON.parse(json) as MyceliumObject;
    } catch {
      return undefined;
    }
  }

  async put(obj: MyceliumObject): Promise<Hash> {
    await this.ensureInit();

    const hash = hashObject(obj);
    const path = this.objectPath(hash);

    // Check if already exists (content-addressed = idempotent)
    if (existsSync(path)) {
      return hash;
    }

    // Ensure directory
    await mkdir(dirname(path), { recursive: true });

    // Store canonical form (source of truth, verifiable)
    const canonicalForm = canonical(obj);
    await writeFile(path, canonicalForm, 'utf8');

    // Store JSON form (for reconstruction without S-expr parser)
    await writeFile(path + '.json', JSON.stringify(obj, null, 2), 'utf8');

    // Stage the new object
    await this.git('add', path, path + '.json');

    if (this.autoCommit) {
      await this.commit(`Add ${obj._type}: ${hash.slice(0, 8)}`);
    }

    return hash;
  }

  async has(hash: Hash): Promise<boolean> {
    await this.ensureInit();
    const path = this.objectPath(hash);
    return existsSync(path);
  }

  async list(): Promise<Hash[]> {
    await this.ensureInit();
    const objectsDir = join(this.repoPath, 'objects');
    const hashes: Hash[] = [];

    try {
      const { readdir, stat } = await import('fs/promises');
      const prefixes = await readdir(objectsDir);

      for (const prefix of prefixes) {
        const prefixDir = join(objectsDir, prefix);
        const stats = await stat(prefixDir);
        if (stats.isDirectory()) {
          const files = await readdir(prefixDir);
          for (const file of files) {
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

  // ===========================================================================
  // Git-Specific Operations
  // ===========================================================================

  /**
   * Initialize the git repository if needed
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Create repo directory
    await mkdir(this.repoPath, { recursive: true });

    // Initialize git repo if not exists
    const gitDir = join(this.repoPath, '.git');
    if (!existsSync(gitDir)) {
      await this.git('init');
      await this.git('checkout', '-b', this.branch);

      // Create initial structure
      await mkdir(join(this.repoPath, 'objects'), { recursive: true });
      await mkdir(join(this.repoPath, 'contexts'), { recursive: true });

      // Create .gitignore
      await writeFile(
        join(this.repoPath, '.gitignore'),
        '# Temporary files\n*.tmp\n*.swp\n.DS_Store\n',
        'utf8'
      );

      // Create README
      await writeFile(
        join(this.repoPath, 'README.md'),
        `# Mycelium Hypergraph Store

This repository contains a content-addressed hypergraph.

## Structure

- \`objects/\` - Content-addressed Mycelium objects (symbols, edges, paths)
- \`contexts/\` - Named context snapshots
- \`HEAD.ctx\` - Current active context

## Object Format

Objects are stored as canonical S-expressions with JSON sidecars:
- \`{hash}\` - Canonical S-expression (for verification)
- \`{hash}.json\` - JSON reconstruction (for tooling)

Generated by Foundation/Mycelium.
`,
        'utf8'
      );

      // Initial commit
      await this.git('add', '-A');
      await this.git('commit', '-m', 'Initialize mycelium hypergraph store');
    }

    this.initialized = true;
  }

  /**
   * Commit staged changes
   */
  async commit(message: string): Promise<string> {
    await this.ensureInit();
    try {
      const result = await this.git('commit', '-m', message);
      // Extract commit hash from output
      const match = result.stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/);
      return match ? match[1] : '';
    } catch (e: unknown) {
      // No changes to commit is fine
      if (e instanceof Error && e.message.includes('nothing to commit')) {
        return '';
      }
      throw e;
    }
  }

  /**
   * Create a context snapshot as a git commit
   *
   * This is where the git-as-hypergraph magic happens:
   * - Context state → commit message + tagged
   * - Context parents → commit parents
   * - Agent branch → updated ref
   */
  async commitContext(
    ctx: Context,
    message: string,
    agentId?: string
  ): Promise<{ contextHash: Hash; commitHash: string }> {
    await this.ensureInit();

    // Store the context object itself
    const contextHash = await this.put(ctx);

    // Write current context to file
    const ctxFile = join(this.repoPath, 'contexts', `${agentId || 'default'}.ctx`);
    await mkdir(dirname(ctxFile), { recursive: true });
    await writeFile(ctxFile, JSON.stringify(ctx, null, 2), 'utf8');

    // Update HEAD.ctx
    await writeFile(
      join(this.repoPath, 'HEAD.ctx'),
      JSON.stringify({ active: agentId || 'default', hash: contextHash }, null, 2),
      'utf8'
    );

    // Stage and commit
    await this.git('add', '-A');

    const fullMessage = `${message}\n\nContext: ${contextHash}\nAgent: ${agentId || 'default'}`;
    const commitHash = await this.commit(fullMessage);

    return { contextHash, commitHash };
  }

  /**
   * Record a path (understanding trajectory) with full git history
   */
  async recordPath(path: Path, message?: string): Promise<Hash> {
    await this.ensureInit();

    const hash = await this.put(path);

    // Also store in a dedicated paths directory for easy listing
    const pathFile = join(this.repoPath, 'paths', `${hash.slice(0, 16)}.path`);
    await mkdir(dirname(pathFile), { recursive: true });
    await writeFile(
      pathFile,
      JSON.stringify(
        {
          hash,
          question: path.question,
          steps: path.steps.length,
          by: path.provenance.by,
          at: path.provenance.at,
        },
        null,
        2
      ),
      'utf8'
    );

    await this.git('add', '-A');
    await this.commit(message || `Record path: ${path.question.slice(0, 50)}`);

    return hash;
  }

  /**
   * List all recorded paths
   */
  async listPaths(): Promise<Array<{ hash: Hash; question: string; by: string; at: string }>> {
    await this.ensureInit();
    const pathsDir = join(this.repoPath, 'paths');
    const paths: Array<{ hash: Hash; question: string; by: string; at: string }> = [];

    try {
      const { readdir } = await import('fs/promises');
      const files = await readdir(pathsDir);

      for (const file of files) {
        if (file.endsWith('.path')) {
          const content = await readFile(join(pathsDir, file), 'utf8');
          const meta = JSON.parse(content);
          paths.push(meta);
        }
      }
    } catch {
      // No paths yet
    }

    return paths.sort((a, b) => b.at.localeCompare(a.at));
  }

  /**
   * Push to remote
   */
  async push(): Promise<void> {
    await this.ensureInit();
    try {
      await this.git('push', this.remote, this.branch);
    } catch (e: unknown) {
      // Remote might not be configured
      if (e instanceof Error && !e.message.includes('No configured push destination')) {
        throw e;
      }
    }
  }

  /**
   * Pull from remote
   */
  async pull(): Promise<void> {
    await this.ensureInit();
    try {
      await this.git('pull', this.remote, this.branch);
    } catch (e: unknown) {
      // Remote might not be configured
      if (e instanceof Error && !e.message.includes('No configured push destination')) {
        throw e;
      }
    }
  }

  /**
   * Get git log for the repository
   */
  async log(limit = 20): Promise<
    Array<{
      hash: string;
      message: string;
      author: string;
      date: string;
    }>
  > {
    await this.ensureInit();
    try {
      const result = await this.git(
        'log',
        `--format=%H|%s|%an|%aI`,
        `-n${limit}`
      );

      return result.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [hash, message, author, date] = line.split('|');
          return { hash, message, author, date };
        });
    } catch {
      return [];
    }
  }

  /**
   * Checkout a specific commit (time travel)
   */
  async checkout(ref: string): Promise<void> {
    await this.ensureInit();
    await this.git('checkout', ref);
  }

  /**
   * Create a new branch (new worldview)
   */
  async createBranch(name: string, from?: string): Promise<void> {
    await this.ensureInit();
    if (from) {
      await this.git('checkout', '-b', name, from);
    } else {
      await this.git('checkout', '-b', name);
    }
    this.branch = name;
  }

  /**
   * Switch to existing branch
   */
  async switchBranch(name: string): Promise<void> {
    await this.ensureInit();
    await this.git('checkout', name);
    this.branch = name;
  }

  /**
   * List branches (worldviews)
   */
  async listBranches(): Promise<string[]> {
    await this.ensureInit();
    const result = await this.git('branch', '--list', '--format=%(refname:short)');
    return result.stdout.trim().split('\n').filter(Boolean);
  }

  /**
   * Get current branch
   */
  async currentBranch(): Promise<string> {
    await this.ensureInit();
    const result = await this.git('branch', '--show-current');
    return result.stdout.trim();
  }

  /**
   * Merge another branch into current
   */
  async merge(branch: string, message?: string): Promise<void> {
    await this.ensureInit();
    await this.git('merge', branch, '-m', message || `Merge ${branch}`);
  }

  /**
   * Get diff between two refs
   */
  async diff(from: string, to = 'HEAD'): Promise<string> {
    await this.ensureInit();
    const result = await this.git('diff', from, to, '--stat');
    return result.stdout;
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  private objectPath(hash: Hash): string {
    const prefix = hash.slice(0, 2);
    return join(this.repoPath, 'objects', prefix, hash);
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  private async git(
    ...args: string[]
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execFileAsync('git', args, {
        cwd: this.repoPath,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
    } catch (e: unknown) {
      const error = e as Error & { stdout?: string; stderr?: string };
      // Include git output in error message
      const message = error.stderr || error.stdout || error.message;
      throw new Error(`git ${args.join(' ')}: ${message}`);
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a git-backed store at the default global location
 */
export function createGitStore(repoPath?: string): GitStore {
  const path =
    repoPath || join(process.env.HOME || '.', '.foundation', 'mycelium-git');
  return new GitStore({ repoPath: path });
}

/**
 * Create a git-backed store for a specific project
 */
export function createProjectGitStore(projectRoot: string): GitStore {
  return new GitStore({
    repoPath: join(projectRoot, '.context', 'mycelium'),
  });
}

// =============================================================================
// Hydration: Git → In-Memory Index
// =============================================================================

/**
 * Hydrate an in-memory index from a git store.
 * Use this to populate fast lookup structures on startup.
 */
export async function hydrateFromGit(
  gitStore: GitStore
): Promise<{
  symbols: Map<Hash, MyceliumObject>;
  edges: Map<Hash, MyceliumObject>;
  paths: Map<Hash, MyceliumObject>;
  byType: Map<string, Hash[]>;
}> {
  const symbols = new Map<Hash, MyceliumObject>();
  const edges = new Map<Hash, MyceliumObject>();
  const paths = new Map<Hash, MyceliumObject>();
  const byType = new Map<string, Hash[]>();

  const hashes = await gitStore.list();

  for (const hash of hashes) {
    const obj = await gitStore.get(hash);
    if (!obj) continue;

    // Index by type
    const typeList = byType.get(obj._type) || [];
    typeList.push(hash);
    byType.set(obj._type, typeList);

    // Type-specific maps
    switch (obj._type) {
      case 'sym':
        symbols.set(hash, obj);
        break;
      case 'edge':
        edges.set(hash, obj);
        break;
      case 'path':
        paths.set(hash, obj);
        break;
    }
  }

  return { symbols, edges, paths, byType };
}
