// Demo: play one policy-driven day-and-a-bit in Node and print the ledger.
// `npm run headless`

import process from 'node:process';
import { TICKS_PER_DAY } from './balance';
import { runPolicyGame } from './policy';
import { clockOf } from './time';

const seed = Number(process.argv[2] ?? 1740);
const days = Number(process.argv[3] ?? 3);

const state = runPolicyGame(seed, TICKS_PER_DAY * days);
const clock = clockOf(state.tick);

console.log(`seed ${seed} · day ${clock.day}, ${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`);
console.log(`coin: ${state.coin}`);
console.log(`fleece at farm: ${state.stores.farm?.fleece ?? 0}`);
console.log(`cart: ${JSON.stringify(state.carts[0].location)}`);
console.log(`--- last events ---`);
for (const e of state.log.slice(-10)) console.log(`  [${e.tick}] ${e.text}`);
