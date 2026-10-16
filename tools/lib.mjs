// Shared helpers for the level tools (Node only).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const E = require('../js/engine.js');
export const G = require('../js/generator.js');
export const { rng, construct, playouts, echoUse } = G;

export function show(rows) {
  return rows.map((r) => '  ' + [...r].join(' ')).join('\n');
}
