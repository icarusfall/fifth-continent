// Demo: play a policy-driven game in Node and print the ledger.
// `npm run headless [seed] [days] [carter|smuggler]`

import process from 'node:process';
import { TICKS_PER_DAY } from './balance';
import { greedyCarterPolicy, runPolicyGame, smugglerPolicy } from './policy';
import { clockOf } from './time';

const seed = Number(process.argv[2] ?? 1740);
const days = Number(process.argv[3] ?? 3);
const life = process.argv[4] === 'smuggler' ? smugglerPolicy : greedyCarterPolicy;

const state = runPolicyGame(seed, TICKS_PER_DAY * days, life);
const clock = clockOf(state.tick);

console.log(`seed ${seed} · day ${clock.day}, ${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`);
console.log(`coin: ${state.coin} · rent paid: ${state.rentPaid} · flock: ${state.flockSize}`);
console.log(`fleece at farm: ${state.stores.farm?.fleece ?? 0}`);
if (state.cuttingHouse) {
  console.log(`cutting house at (${state.cuttingHouse.x}, ${state.cuttingHouse.y}): ${JSON.stringify(state.stores['cutting-house'])}`);
}
console.log(`cart: ${JSON.stringify(state.carts[0].location)} cargo: ${JSON.stringify(state.carts[0].cargo)}`);
console.log(`--- last events ---`);
for (const e of state.log.slice(-10)) console.log(`  [${e.tick}] ${e.text}`);
