import { DATA } from '@ranker/engine/data';

// A season to build from before unit-scoring loads (see units.ts)
Object.assign(DATA, (globalThis as { __DATA?: object }).__DATA);
