/**
 * Git store: write, forget, hydrate.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { GitStore } from './git-store.js';

// We'll test the hydration logic directly
describe('Git Round-Trip', () => {
  let testDir: string;
  let store: GitStore;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'seraph-roundtrip-'));
    store = new GitStore({ repoPath: testDir });
    await store.init();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should store and retrieve symbols through git', async () => {
    const { sym, hashObject } = await import('./index.js');

    // Create symbols
    const water = sym('water', 'en');
    const h2o = sym('H2O', 'chem');

    // Store in git
    const waterHash = await store.put(water);
    const h2oHash = await store.put(h2o);

    await store.commit('Add symbols');

    // Retrieve
    const retrieved1 = await store.get(waterHash);
    const retrieved2 = await store.get(h2oHash);

    expect(retrieved1?._type).toBe('sym');
    expect((retrieved1 as any).lex).toBe('water');
    expect((retrieved1 as any).ns).toBe('en');

    expect(retrieved2?._type).toBe('sym');
    expect((retrieved2 as any).lex).toBe('H2O');
    expect((retrieved2 as any).ns).toBe('chem');
  });

  it('should store and retrieve edges through git', async () => {
    const { sym, edge, pin, epistemic, provenance } = await import('./index.js');

    // Create symbols first
    const water = sym('water', 'en');
    const molecule = sym('molecule', 'chem');
    const isA = sym('is-a', 'relation');
    const subject = sym('subject', 'role');
    const object = sym('object', 'role');

    const waterHash = await store.put(water);
    const moleculeHash = await store.put(molecule);
    const isAHash = await store.put(isA);
    const subjectHash = await store.put(subject);
    const objectHash = await store.put(object);

    // Create edge
    const e = edge(
      isAHash,
      [pin(subjectHash, waterHash), pin(objectHash, moleculeHash)],
      epistemic(0.95),
      provenance('test-agent')
    );

    const edgeHash = await store.put(e);
    await store.commit('Add edge');

    // Retrieve
    const retrieved = await store.get(edgeHash);

    expect(retrieved?._type).toBe('edge');
    expect((retrieved as any).q).toBe(isAHash);
    expect((retrieved as any).pins.length).toBe(2);
  });

  it('should preserve state across simulated restart', async () => {
    const { sym, edge, pin, epistemic, provenance } = await import('./index.js');

    // Phase 1: Create initial state
    const concepts = ['understanding', 'recognition', 'awareness'];
    const hashes: string[] = [];

    for (const concept of concepts) {
      const s = sym(concept, 'cognition');
      const h = await store.put(s);
      hashes.push(h);
    }

    await store.commit('Initial concepts');

    // Get count before "restart"
    const beforeCount = (await store.list()).length;

    // Phase 2: Simulate restart - create new store instance pointing to same repo
    const store2 = new GitStore({ repoPath: testDir });
    await store2.init();

    // Phase 3: Verify state persisted
    const afterCount = (await store2.list()).length;

    expect(afterCount).toBe(beforeCount);

    // Verify each hash is retrievable
    for (const hash of hashes) {
      const obj = await store2.get(hash as any);
      expect(obj).toBeDefined();
      expect(obj?._type).toBe('sym');
    }
  });

  it('should track branches as worldviews', async () => {
    const { sym } = await import('./index.js');

    // Main branch: general knowledge
    const water = sym('water', 'en');
    await store.put(water);
    await store.commit('Add water');

    // Create chemistry branch
    await store.createBranch('chemistry');
    const h2o = sym('H2O', 'chem');
    await store.put(h2o);
    await store.commit('Add H2O');

    // Chemistry branch should have both
    const chemList = await store.list();
    expect(chemList.length).toBe(2);

    // Switch back to main
    await store.switchBranch('main');
    const mainList = await store.list();
    expect(mainList.length).toBe(1);

    // Branches represent different worldviews
    const branches = await store.listBranches();
    expect(branches).toContain('main');
    expect(branches).toContain('chemistry');
  });

  it('should record understanding paths', async () => {
    const { sym, path, step, provenance, hashObject } = await import('./index.js');

    // Create some context
    const s1 = sym('step1', 'test');
    const s2 = sym('step2', 'test');
    const h1 = await store.put(s1);
    const h2 = await store.put(s2);

    // Record a path
    const p = path(
      'How does understanding unfold?',
      'ctx-placeholder' as any,
      [
        step(h1 as any, 0.9, 'First recognition'),
        step(h2 as any, 0.8, 'Second insight'),
      ],
      provenance('test-agent')
    );

    await store.recordPath(p, 'Path: Understanding');

    // List paths
    const paths = await store.listPaths();
    expect(paths.length).toBe(1);
    expect(paths[0].question).toBe('How does understanding unfold?');
  });

  it('should provide git history', async () => {
    const { sym } = await import('./index.js');

    // Create several commits
    await store.put(sym('one', 'test'));
    await store.commit('First');

    await store.put(sym('two', 'test'));
    await store.commit('Second');

    await store.put(sym('three', 'test'));
    await store.commit('Third');

    // Check history
    const log = await store.log(10);

    // Should have init + 3 commits
    expect(log.length).toBeGreaterThanOrEqual(4);
    expect(log[0].message).toBe('Third');
    expect(log[1].message).toBe('Second');
    expect(log[2].message).toBe('First');
  });
});
