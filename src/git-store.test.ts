/**
 * GitStore Tests
 *
 * Tests for the git-backed content-addressed store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { GitStore, createGitStore, hydrateFromGit } from './git-store.js';
import { sym, edge, pin, epistemic, provenance, path, step, activation } from './index.js';
import { hashObject } from './hash.js';
import type { Hash } from './types.js';

describe('GitStore', () => {
  let testDir: string;
  let store: GitStore;

  beforeEach(async () => {
    // Create a fresh temp directory for each test
    testDir = await mkdtemp(join(tmpdir(), 'mycelium-git-test-'));
    store = new GitStore({ repoPath: testDir });
    await store.init();
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('creates a git repository', async () => {
      const { existsSync } = await import('fs');
      expect(existsSync(join(testDir, '.git'))).toBe(true);
    });

    it('creates object and context directories', async () => {
      const { existsSync } = await import('fs');
      expect(existsSync(join(testDir, 'objects'))).toBe(true);
      expect(existsSync(join(testDir, 'contexts'))).toBe(true);
    });

    it('creates initial commit', async () => {
      const log = await store.log(1);
      expect(log.length).toBe(1);
      expect(log[0].message).toContain('Initialize');
    });
  });

  describe('put/get symbols', () => {
    it('stores and retrieves a symbol', async () => {
      const symbol = sym('water', 'en');
      const hash = await store.put(symbol);

      expect(hash).toBeTruthy();
      expect(hash.length).toBe(52); // base32 SHA-256

      const retrieved = await store.get(hash);
      expect(retrieved).toBeDefined();
      expect(retrieved?._type).toBe('sym');
      expect((retrieved as typeof symbol).lex).toBe('water');
      expect((retrieved as typeof symbol).ns).toBe('en');
    });

    it('returns same hash for identical symbols', async () => {
      const s1 = sym('molecule', 'chem');
      const s2 = sym('molecule', 'chem');

      const h1 = await store.put(s1);
      const h2 = await store.put(s2);

      expect(h1).toBe(h2);
    });

    it('returns undefined for non-existent hash', async () => {
      const fakeHash = 'a'.repeat(52) as Hash;
      const result = await store.get(fakeHash);
      expect(result).toBeUndefined();
    });
  });

  describe('put/get edges', () => {
    it('stores and retrieves an edge', async () => {
      // First store some symbols
      const waterSym = sym('water', 'en');
      const moleculeSym = sym('molecule', 'chem');
      const isASym = sym('is-a', 'relation');
      const subjectRole = sym('subject', 'role');
      const objectRole = sym('object', 'role');

      const waterHash = await store.put(waterSym);
      const moleculeHash = await store.put(moleculeSym);
      const isAHash = await store.put(isASym);
      const subjectHash = await store.put(subjectRole);
      const objectHash = await store.put(objectRole);

      // Create an edge
      const e = edge(
        isAHash,
        [pin(subjectHash, waterHash), pin(objectHash, moleculeHash)],
        epistemic(0.95, 1),
        provenance('test-agent', '2024-01-01T00:00:00Z')
      );

      const edgeHash = await store.put(e);
      const retrieved = await store.get(edgeHash);

      expect(retrieved).toBeDefined();
      expect(retrieved?._type).toBe('edge');
      expect((retrieved as typeof e).q).toBe(isAHash);
      expect((retrieved as typeof e).pins.length).toBe(2);
    });
  });

  describe('has', () => {
    it('returns true for stored objects', async () => {
      const symbol = sym('test', 'default');
      const hash = await store.put(symbol);

      expect(await store.has(hash)).toBe(true);
    });

    it('returns false for non-existent objects', async () => {
      const fakeHash = 'b'.repeat(52) as Hash;
      expect(await store.has(fakeHash)).toBe(false);
    });
  });

  describe('list', () => {
    it('lists all stored hashes', async () => {
      const s1 = sym('one', 'test');
      const s2 = sym('two', 'test');
      const s3 = sym('three', 'test');

      const h1 = await store.put(s1);
      const h2 = await store.put(s2);
      const h3 = await store.put(s3);

      const hashes = await store.list();

      expect(hashes).toContain(h1);
      expect(hashes).toContain(h2);
      expect(hashes).toContain(h3);
    });
  });

  describe('commit', () => {
    it('commits staged changes', async () => {
      const symbol = sym('commit-test', 'test');
      await store.put(symbol);

      const commitHash = await store.commit('Test commit');
      expect(commitHash).toBeTruthy();

      const log = await store.log(1);
      expect(log[0].message).toBe('Test commit');
    });
  });

  describe('branches', () => {
    it('creates a new branch', async () => {
      await store.createBranch('branch-c');

      const branches = await store.listBranches();
      expect(branches).toContain('branch-c');

      const current = await store.currentBranch();
      expect(current).toBe('branch-c');
    });

    it('switches between branches', async () => {
      await store.createBranch('branch-a');
      await store.switchBranch('main');
      await store.createBranch('branch-b');

      expect(await store.currentBranch()).toBe('branch-b');

      await store.switchBranch('branch-a');
      expect(await store.currentBranch()).toBe('branch-a');
    });

    it('each branch can have different content', async () => {
      // Add symbol to main
      const s1 = sym('main-only', 'test');
      await store.put(s1);
      await store.commit('Add main-only');

      // Create branch and add different symbol
      await store.createBranch('feature');
      const s2 = sym('feature-only', 'test');
      await store.put(s2);
      await store.commit('Add feature-only');

      // Feature branch should have both
      const featureList = await store.list();
      const h1 = hashObject(s1);
      const h2 = hashObject(s2);
      expect(featureList).toContain(h1);
      expect(featureList).toContain(h2);

      // Switch back to main - should only have main-only
      await store.switchBranch('main');
      const mainList = await store.list();
      expect(mainList).toContain(h1);
      expect(mainList).not.toContain(h2);
    });
  });

  describe('paths', () => {
    it('records and lists paths', async () => {
      // Create some symbols and edges first
      const waterSym = sym('water', 'en');
      const h2oSym = sym('H2O', 'chem');
      const isASym = sym('is-a', 'relation');
      const subjectRole = sym('subject', 'role');
      const objectRole = sym('object', 'role');

      const waterHash = await store.put(waterSym);
      const h2oHash = await store.put(h2oSym);
      const isAHash = await store.put(isASym);
      const subjectHash = await store.put(subjectRole);
      const objectHash = await store.put(objectRole);

      const e = edge(
        isAHash,
        [pin(subjectHash, waterHash), pin(objectHash, h2oHash)],
        epistemic(0.9, 1),
        provenance('test-agent')
      );
      const edgeHash = await store.put(e);

      // Create a path
      const p = path(
        'What is water?',
        'ctx-hash-placeholder' as Hash,
        [step(edgeHash, 0.9, 'Water is H2O')],
        provenance('test-agent')
      );

      const pathHash = await store.recordPath(p, 'Understanding water');

      // List paths
      const paths = await store.listPaths();
      expect(paths.length).toBe(1);
      expect(paths[0].question).toBe('What is water?');
    });
  });

  describe('log', () => {
    it('returns commit history', async () => {
      await store.put(sym('one', 'test'));
      await store.commit('First commit');

      await store.put(sym('two', 'test'));
      await store.commit('Second commit');

      const log = await store.log(10);

      // Should have initial + 2 commits
      expect(log.length).toBeGreaterThanOrEqual(3);
      expect(log[0].message).toBe('Second commit');
      expect(log[1].message).toBe('First commit');
    });
  });

  describe('hydration', () => {
    it('hydrates index from git store', async () => {
      // Store some objects
      const s1 = sym('alpha', 'test');
      const s2 = sym('beta', 'test');
      const s3 = sym('gamma', 'test');

      await store.put(s1);
      await store.put(s2);
      await store.put(s3);

      // Hydrate
      const index = await hydrateFromGit(store);

      expect(index.symbols.size).toBe(3);
      expect(index.byType.get('sym')?.length).toBe(3);
    });
  });
});

describe('GitStore autoCommit', () => {
  let testDir: string;
  let store: GitStore;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'mycelium-git-auto-'));
    store = new GitStore({ repoPath: testDir, autoCommit: true });
    await store.init();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('auto-commits on put when enabled', async () => {
    const initialLog = await store.log(10);
    const initialCount = initialLog.length;

    await store.put(sym('auto-test', 'test'));

    const afterLog = await store.log(10);
    expect(afterLog.length).toBe(initialCount + 1);
    expect(afterLog[0].message).toContain('Add sym');
  });
});
