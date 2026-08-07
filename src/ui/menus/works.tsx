// The works & men rows shared by the farm and the cutting house (stage 2):

// cellar, walls, garrison, and the workshop. Moved verbatim.



import { useMemo } from 'react';
import { CELLAR_COST, CELLAR_COVER_PER_TIER, CREW_MUSTER, CREW_WAGE, FORT_COST, MAX_CELLAR_TIER, MAX_FORT_TIER, MILITIA_MUSTER, MILITIA_WAGE, RESEARCH_COST, RESEARCH_DAYS } from '../../sim/balance';
import { moatedAt } from '../../sim/dykes';
import { fenceActiveAt } from '../../sim/leiden';
import { defenceCeiling, expectedRaid } from '../../sim/raid';
import { coverOf } from '../../sim/revenue';
import { garrisonCap } from '../../sim/tick';
import type { GameState, NodeId } from '../../sim/types';
import { HEAT_RED } from '../palette';
import { BenchNote, FORT_TIER_LABEL, LEIDEN_TIERS, useEnqueue } from './shared';
/**
 * Spec §6.12 — dig in one rung of the Trade line. The cost is coin now; the
 * cost the player learns to fear is being *seen* — the button says so.
 */
/** §6.12 (M5½ playtest) — the fort ladder's quiet twin: cover, bought. */
export function CellarRow({ state, nodeId }: { state: GameState; nodeId: NodeId }) {
  const enqueue = useEnqueue();
  const tier = state.cellars[nodeId] ?? 0;
  const maxed = tier >= MAX_CELLAR_TIER;
  const cost = maxed ? 0 : CELLAR_COST[tier + 1];
  const canAfford = state.coin >= cost;

  return (
    <>
      <p className="flavour">
        Hides: <strong>{coverOf(state, nodeId)}</strong> of anything rest unseen here
        {tier > 0 ? ` (a cellar${tier > 1 ? ' with a false wall' : ''} under the boards)` : ''}.
        {state.informer && tier > 0
          ? ' The parish talked, but nobody ever saw this dug.'
          : ''}
      </p>
      <div className="menu-buttons">
        <button
          disabled={maxed || !canAfford}
          title={
            maxed
              ? 'Any deeper is a well.'
              : canAfford
                ? 'Dry, dark, on no plan anywhere — and the Revenue never notices, which is the point.'
                : `${cost} coin, and the till is short.`
          }
          onClick={() => enqueue({ type: 'digCellar', nodeId })}
        >
          {maxed
            ? 'The hides are dug'
            : `Dig a cellar hide · +${CELLAR_COVER_PER_TIER} cover · ${cost} coin`}
        </button>
      </div>
    </>
  );
}


export function FortifyRow({ state, nodeId }: { state: GameState; nodeId: NodeId }) {
  const enqueue = useEnqueue();
  const tier = state.fortifications[nodeId] ?? 0;
  const maxed = tier >= MAX_FORT_TIER;
  const cost = maxed ? 0 : FORT_COST[tier + 1];
  const canAfford = state.coin >= cost;

  return (
    <>
      <p className="flavour">
        Works: <strong>{FORT_TIER_LABEL[tier]}</strong> ({tier}/{MAX_FORT_TIER}).{' '}
        {tier > 0
          ? 'Harder to storm — and the Revenue sees the walls.'
          : 'Undug, and quiet as wool.'}
      </p>
      <div className="menu-buttons">
        <button
          disabled={maxed || !canAfford}
          title={
            maxed
              ? 'As hard as it gets.'
              : canAfford
                ? 'Every rung hardens the building — and shouts the louder to London.'
                : `${cost} coin, and the till is short.`
          }
          onClick={() => enqueue({ type: 'fortifyBuilding', nodeId })}
        >
          {maxed ? 'Fully fortified' : `Dig in · ${FORT_TIER_LABEL[tier + 1]} · ${cost} coin`}
        </button>
      </div>
    </>
  );
}


const RAIDER: Record<string, string> = {
  hawksmere: 'the Hawksmere Company',
  'water-guard': 'the Water Guard',
  dragoons: 'Dragoons' };

/**
 * §6.13 (M5½e) — the charge, read where the men are posted and while there is
 * still time to act on it: who would come today, what these men and works turn
 * back (asked of the engine itself, §M5½d), and — on dry ground — what the
 * same men would hold behind a cut channel. The raid card says this at the
 * wall; by then the spade is too slow.
 */
function ChargeReading({ state, nodeId }: { state: GameState; nodeId: NodeId }) {
  const g = state.garrisons[nodeId] ?? { militia: 0, crew: 0 };
  const men = g.militia + g.crew;
  const tier = state.fortifications[nodeId] ?? 0;
  const moated = moatedAt(state, nodeId);
  const fence = fenceActiveAt(state, nodeId);
  const { faction, size } = expectedRaid(state);
  // The bisection runs ~10 battles; memoised on everything the engine reads,
  // so the menu's once-a-second re-render pays nothing while nothing changed.
  const reading = useMemo(
    () =>
      men === 0
        ? null
        : {
            hold: defenceCeiling(state, nodeId, faction),
            behindWater: moated ? 0 : defenceCeiling(state, nodeId, faction, 'moated') },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [g.militia, g.crew, tier, moated, fence, faction, nodeId],
  );
  if (!state.hawksmere.provoked || men === 0 || !reading) return null;
  const holds = reading.hold >= size;
  return (
    <p className="flavour">
      The charge: {RAIDER[faction] ?? 'raiders'} would bring <strong>{size}</strong>; these men
      and works turn back about <strong>{reading.hold}</strong>
      {moated ? ' behind the water' : ''}.{' '}
      <span style={holds ? undefined : { color: HEAT_RED }}>
        {holds ? 'As it stands, the wall holds.' : 'As it stands, they carry it.'}
      </span>
      {!moated &&
        reading.behindWater > reading.hold &&
        ` Behind a cut channel at this foot the same ${men} would hold ${reading.behindWater} — the water is a wall the works cannot be.`}
    </p>
  );
}

/**
 * Spec §6.13 — the garrison: the men behind the works. Militia are cheap and
 * break early; crew hold. Wages fall at dawn with the carter's, and a wall
 * that cannot be paid deserts — the row says all of it before the coin moves.
 */
export function GarrisonRow({ state, nodeId }: { state: GameState; nodeId: NodeId }) {
  const enqueue = useEnqueue();
  const g = state.garrisons[nodeId] ?? { militia: 0, crew: 0 };
  const men = g.militia + g.crew;
  const cap = garrisonCap(state, nodeId);
  const full = men >= cap;
  const wageBill = g.militia * MILITIA_WAGE + g.crew * CREW_WAGE;
  const held =
    men === 0
      ? 'nobody'
      : [
          g.militia > 0 ? `${g.militia} militia` : '',
          g.crew > 0 ? `${g.crew} crew` : '',
        ]
          .filter(Boolean)
          .join(', ');
  return (
    <>
      <p className="flavour">
        The wall: <strong>{held}</strong> ({men}/{cap} quartered).{' '}
        {men === 0
          ? 'Works without men stop nothing — a raid walks in over empty steps.'
          : `Wages at dawn: ${wageBill} coin. A wall that cannot be paid deserts.`}
      </p>
      <ChargeReading state={state} nodeId={nodeId} />
      {/* §6.13 / §14 — the difference, on the face (read-the-charge rule):
          the smuggler's price buys alpha AND nerve, and the card must say so. */}
      <p className="flavour">
        A militiaman is a marsh farmer with a fowling piece: he shoots at half a
        smuggler&rsquo;s rate and runs at twice the losses — he has a family to get back
        to. A smuggler is armed, willing, and stays for the worst of it. Cheap walls
        waver; dear walls hold.
      </p>
      <div className="menu-buttons">
        <button
          disabled={full || state.coin < MILITIA_MUSTER}
          title={
            full
              ? 'No more quarters. Dig in deeper to hold a larger garrison.'
              : state.coin < MILITIA_MUSTER
                ? `${MILITIA_MUSTER} coin to raise, and the till is short.`
                : 'Fowling pieces and families: cheap, and they break early.'
          }
          onClick={() => enqueue({ type: 'raiseGarrison', nodeId, kind: 'militia' })}
        >
          Post a militiaman · {MILITIA_MUSTER} coin · {MILITIA_WAGE}/day
        </button>
        <button
          disabled={full || state.coin < CREW_MUSTER}
          title={
            full
              ? 'No more quarters. Dig in deeper to hold a larger garrison.'
              : state.coin < CREW_MUSTER
                ? `${CREW_MUSTER} coin to raise, and the till is short.`
                : 'Armed, willing, experienced — they hold the wall.'
          }
          onClick={() => enqueue({ type: 'raiseGarrison', nodeId, kind: 'crew' })}
        >
          Post a smuggler · {CREW_MUSTER} coin · {CREW_WAGE}/day
        </button>
        {g.militia > 0 && (
          <button onClick={() => enqueue({ type: 'dismissGarrison', nodeId, kind: 'militia' })}>
            Stand a militiaman down
          </button>
        )}
        {g.crew > 0 && (
          <button onClick={() => enqueue({ type: 'dismissGarrison', nodeId, kind: 'crew' })}>
            Stand a smuggler down
          </button>
        )}
      </div>
    </>
  );
}


/**
 * §6.14 (M5c) — the workshop: Leiden's bench, in the building that houses
 * him. Research here, and the strongbox's held letters when there are any.
 */
export function WorkshopRow({ state, nodeId }: { state: GameState; nodeId: NodeId }) {
  const enqueue = useEnqueue();
  if (state.leiden.state !== 'housed' || state.leiden.node !== nodeId) return null;
  const r = state.research;
  const tier = r.completed.leiden;
  const held = state.leiden.heldLetters.length;
  const benchBusy = r.active !== null;
  const downedTools = held >= 3;
  return (
    <>
      <h5>the workshop</h5>
      <p className="flavour">
        The philosopher keeps his bench behind the hides, and the room smells of storms.
        {tier > 0 &&
          ` Learned: ${LEIDEN_TIERS.slice(0, tier)
            .map((t) => t.name)
            .join(' · ')}.`}
      </p>
      {state.leiden.letterPending !== null && (
        <p className="flavour">A letter sits sealed on the bench. He will not work past it.</p>
      )}
      {/* §6.14 (M5½e) — the bench's read-out: the project by name, days left. */}
      <BenchNote state={state} />
      {tier < LEIDEN_TIERS.length && state.leiden.letterPending === null && (
        <div className="menu-buttons">
          <button
            disabled={benchBusy || downedTools || state.coin < RESEARCH_COST.leiden[tier]}
            title={
              benchBusy
                ? 'The bench holds one project at a time.'
                : downedTools
                  ? 'Three letters sit in your strongbox. He has downed tools until one goes out.'
                  : state.coin < RESEARCH_COST.leiden[tier]
                    ? `The work wants ${RESEARCH_COST.leiden[tier]} coin up front, and the till is short.`
                    : `${LEIDEN_TIERS[tier].effect} — ${LEIDEN_TIERS[tier].price}. And a letter will want sending.`
            }
            onClick={() => enqueue({ type: 'startResearch', tree: 'leiden' })}
          >
            Learn: {LEIDEN_TIERS[tier].name} · {RESEARCH_COST.leiden[tier]} coin ·{' '}
            {RESEARCH_DAYS.leiden[tier]} days
          </button>
        </div>
      )}
      {held > 0 && (
        <div className="menu-buttons">
          <button
            title="The floor rises late — late news from this parish is still news."
            onClick={() => enqueue({ type: 'releaseLetter' })}
          >
            Let an old letter out of the strongbox · {held} held
          </button>
        </div>
      )}
    </>
  );
}
