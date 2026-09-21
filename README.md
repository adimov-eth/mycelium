# mycelium

TypeScript hypergraph memory. Persistence across sessions.

A symbol means nothing alone. Meaning is the n-ary edge (roles, pins). A path is how understanding unfolded, not only the conclusion. A context is a worldview (OR-set of activations). Objects are content-addressed.

Not completed. Not a product.

## What is here

- `src/types.ts` — symbol, edge, activation, context, path
- `src/store.ts` — memory and file stores
- `src/git-store.ts` — same objects as git blobs / contexts as commits
- `src/hash.ts`, `src/canonical.ts` — SHA-256, canonical form
- tests for the git store

## What is not

A running agent memory. A worker. A Cloudflare stack.

## Commands

```bash
bun install
bun run typecheck
bun test
```
