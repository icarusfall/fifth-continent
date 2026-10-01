// The marsh's own menus (stage 2): the dyke post, the wight-sign, the

// stone, the officer — and the forfeit card. Moved verbatim.



import { HEAT_RED } from '../../shared/palette';
import { BINDING_CAPACITY, CROSSING_FRONTAGE, DYKE_DEBT, DYKE_PASTURE_HEAD, MARSH_VEIL_DEBT, MARSH_VEIL_DIV, RESEARCH_COST, RESEARCH_DAYS, TICKS_PER_DAY, TRIBUTE_RELIEF, TUB_BOAT_CAPACITY, WIGHT_TRAP_IRON } from '../../sim/balance';
import { cutWouldMoat, dykeCost, dykeDays, dykePreview, dykeWaterways, stoneRefuses } from '../../sim/dykes';
import type { WaterwayPair } from '../../sim/dykes';
import { dykeById, dykeTiles, edgesFor, nodeById } from '../../sim/map';
import type { GameState } from '../../sim/types';
import { useGameStore } from '../../state/store';
import { BenchNote, MARSH_TIERS, StoreFill, useEnqueue } from './shared';
/**
 * §6.18 (M5½a) — a surveyed channel's post: the dig offered with its whole
 * price on its face (coin, days, Debt, the parish, the pasture — §21.2's
 * axis, read aloud before the spade goes in). M5½b playtest: and what it
 * JOINS, said before the price — a player digs channels to link places, and
 * the one thing the post would not tell them was which places.
 */
export function DykeMenu({ state, dykeId }: { state: GameState; dykeId: string }) {
  const enqueue = useEnqueue();
  const seg = dykeById(dykeId);
  if (!seg) return null;
  const dug = state.dykesDug.includes(seg.id);
  const inHand = state.digging?.id === seg.id;
  const busy = state.digging !== null && !inHand;
  const refused = stoneRefuses(state, seg);
  const cost = dykeCost(seg);
  const short = state.coin < cost;
  // §6.18 (M5½b playtest) — the route this cut would open, one step of
  // lookahead when it opens none alone.
  const preview = dug || inHand ? null : dykePreview(state, seg.id);
  // §6.18 (M5½e) — and the wall it would water, the survey's other invitation.
  const wouldMoat = dug || inHand ? null : cutWouldMoat(state, seg.id);
  const pairName = (p: WaterwayPair) =>
    `${nodeById(p.a, state.farm, state.cuttingHouse).name} to ${
      nodeById(p.b, state.farm, state.cuttingHouse).name
    }`;
  const pairList = (pairs: WaterwayPair[]) => pairs.map(pairName).join(', and ');
  const standing = dug ? dykeWaterways(state) : [];
  return (
    <>
      <h4>{seg.name}</h4>
      {dug ? (
        <>
          <p className="flavour">
            Clean water, cut banks, and drained grazing either side. The gentry call it
            improvement; the marsh keeps its own account of it. A dyke is never filled in.
          </p>
          <p className="flavour">
            {standing.length > 0
              ? `Water you can carry on, as it stands: ${standing
                  .map((e) => e.name)
                  .join(', ')}.`
              : 'No landing yet stands at both ends of your water. Until one does, this is drainage and pasture, and no road at all.'}
          </p>
        </>
      ) : inHand ? (
        <p className="flavour">
          The crew is in it now — mud to the knees, done in about{' '}
          {Math.max(1, Math.ceil((state.digging!.doneTick - state.tick) / TICKS_PER_DAY))} day
          {Math.ceil((state.digging!.doneTick - state.tick) / TICKS_PER_DAY) === 1 ? '' : 's'}.
        </p>
      ) : (
        <>
          {/* §6.18 (M5½b playtest) — the road first, the price second: what a
              cut JOINS is the reason to dig it, and the post never said. */}
          {preview && preview.opens.length > 0 ? (
            <p className="flavour">
              <strong>Dug, this opens the water from {pairList(preview.opens)}</strong> —{' '}
              {TUB_BOAT_CAPACITY} to the load, quiet as weed, and no blue coat rides a
              channel.
            </p>
          ) : preview?.nextStep ? (
            <p className="flavour">
              Alone, this joins no landing. Cut it <em>and</em> {preview.nextStep.name} and the
              two together open {pairList(preview.nextStep.opens)} — half a road, and the
              other half is on the survey.
            </p>
          ) : preview ? (
            <p className="flavour">
              This line reaches no landing at either end, and no hull will ever use it. A
              channel is a road only where it meets a landing at both ends; some cuts are
              only pasture, and the marsh does not mind which you dig.
            </p>
          ) : null}
          {/* §6.18 (M5½e) — the other reason to dig: water at a wall's foot.
              Named here as the works menu's charge-reading names its want. */}
          {!dug && !inHand && wouldMoat && (
            <p className="flavour">
              <strong>
                And it lays water at the foot of{' '}
                {nodeById(wouldMoat, state.farm, state.cuttingHouse).name}
              </strong>{' '}
              — a moat. Raiders come at a moated wall {CROSSING_FRONTAGE} abreast and no more,
              while {CROSSING_FRONTAGE} of yours stand.
            </p>
          )}
          <p className="flavour">
            An old line, silted a century: {dykeTiles(seg)} chains of channel wanting a crew.
            Cut it and the water runs for ever — the marsh smaller by that much ({DYKE_DEBT}{' '}
            to the account), the parish colder for the enclosure, and the drained margin
            grazing {DYKE_PASTURE_HEAD} more head.
          </p>
          <div className="menu-buttons">
            <button
              disabled={busy || refused || short}
              title={
                refused
                  ? 'The men will not put a spade in the ground by the stone.'
                  : busy
                    ? 'The crew is one crew: one dig at a time.'
                    : short
                      ? `The diggers want ${cost} coin up front, and the till is short.`
                      : 'Slow, permanent, and the whole parish will have an opinion.'
              }
              onClick={() => enqueue({ type: 'digDyke', id: seg.id })}
            >
              Cut the channel · {cost} coin · {dykeDays(seg)} days
            </button>
          </div>
          {refused && (
            <p className="flavour">
              The wight-stone stands too near this line. The men will not dig by it, and you
              would not ask twice.
            </p>
          )}
        </>
      )}
    </>
  );
}


/**
 * §6.14 — the wight-sign: a ring of stones, and the trap as a deliberate
 * verb. Iron and salt in coin; the bait in sheep, rising with each binding.
 */
export function SignMenu({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const bait = state.boundWights + 1;
  const trapped = state.wights.trap !== null;
  return (
    <>
      <h4>A Ring of White Stones</h4>
      <p className="flavour">
        The grass inside lies drowned, and the sheep will not graze within a chain of it. The old
        people call it a wight-sign, and know better than to want one.
      </p>
      {/* Playtest: a second ring read as the first being reset — say plainly
          that the stone and the bound stand untouched, and this one is new. */}
      {state.boundWights > 0 && (
        <p className="flavour">
          This ring is a new one. Your stone stands where it stood, and{' '}
          {state.boundWights === 1
            ? 'the bound wight still carries'
            : `the ${state.boundWights} bound still carry`}{' '}
          the account — each ring is its own wight, and each wants its own iron.
        </p>
      )}
      {trapped ? (
        <p className="flavour">
          The trap is staked: iron, salt, and {state.wights.trap!.bait} sheep hobbled in the ring.
          You do not stay to watch. Dawn will tell.
        </p>
      ) : (
        <div className="menu-buttons">
          <button
            disabled={state.coin < WIGHT_TRAP_IRON || state.flockSize < bait}
            title={
              state.coin < WIGHT_TRAP_IRON
                ? `Iron and salt run ${WIGHT_TRAP_IRON} coin, and the till is short.`
                : state.flockSize < bait
                  ? `The trap wants ${bait} sheep staked as bait, and the flock cannot spare them.`
                  : 'At dawn the wight is bound. No roll, no maybe — the marsh keeps bargains it did not offer.'
            }
            onClick={() => enqueue({ type: 'trapWight' })}
          >
            Stake the trap · {WIGHT_TRAP_IRON} coin of iron & salt · {bait} sheep as bait
          </button>
        </div>
      )}
      <p className="flavour">
        Or leave it be. The ring does not fade, and the marsh does not forget being used either
        way.
      </p>
    </>
  );
}

/**
 * §6.14 — the wight-stone: the account read plainly, tribute paid in sheep,
 * and the marsh tree researched where its teacher leans.
 */
export function StoneMenu({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const bindings = state.boundWights * BINDING_CAPACITY;
  const over = state.debt > bindings;
  const r = state.research;
  const tier = r.completed.marsh;
  const cost = RESEARCH_COST.marsh[tier];
  return (
    <>
      <h4>The Wight-Stone</h4>
      <p className="flavour" style={{ color: over ? HEAT_RED : undefined }}>
        The account: <strong>{Math.ceil(state.debt)}</strong> owed against{' '}
        <strong>{bindings}</strong> the bound will carry ({state.boundWights} wight
        {state.boundWights === 1 ? '' : 's'} bound).
        {over
          ? ' The Debt outruns the bound. They are patient for three dawns, and then they are not.'
          : ' It never decays. Nothing about it decays.'}
      </p>
      <StoreFill count={Math.min(Math.ceil(state.debt), Math.max(bindings, 1))} cap={Math.max(bindings, 1)} />
      <div className="menu-buttons">
        <button
          disabled={state.flockSize < 1 || state.debt <= 0}
          title={
            state.debt <= 0
              ? 'The account stands at nothing.'
              : state.flockSize < 1
                ? 'The tribute is a sheep, and there are none to give.'
                : 'Hobbled at the stone tonight; gone by morning. It is always gone by morning.'
          }
          onClick={() => enqueue({ type: 'payTribute' })}
        >
          Leave a sheep in tribute · forgives {TRIBUTE_RELIEF}
        </button>
      </div>

      <h5>what the stone teaches</h5>
      {r.active?.tree === 'marsh' ? (
        <p className="flavour">
          The teaching is under way. Done in about{' '}
          {Math.max(1, Math.ceil((r.active.doneTick - state.tick) / TICKS_PER_DAY))} day
          {Math.ceil((r.active.doneTick - state.tick) / TICKS_PER_DAY) === 1 ? '' : 's'}.
        </p>
      ) : tier >= MARSH_TIERS.length ? (
        <p className="flavour">The stone has taught all it will — for now.</p>
      ) : (
        <div className="menu-buttons">
          {r.active !== null && <BenchNote state={state} />}
          <button
            disabled={r.active !== null || state.coin < cost}
            title={
              r.active !== null
                ? 'The bench holds one project at a time.'
                : state.coin < cost
                  ? `The work wants ${cost} coin up front, and the till is short.`
                  : `${MARSH_TIERS[tier].effect} — ${MARSH_TIERS[tier].price}. Coin is the least of what this costs.`
            }
            onClick={() => enqueue({ type: 'startResearch', tree: 'marsh' })}
          >
            Learn: {MARSH_TIERS[tier].name} · {cost} coin · {RESEARCH_DAYS.marsh[tier]} days
          </button>
        </div>
      )}
      {tier >= 1 && (
        <p className="flavour">
          Learned:{' '}
          {MARSH_TIERS.slice(0, tier)
            .map((t) => t.name)
            .join(' · ')}
          .
        </p>
      )}
      {tier >= 4 && (
        <>
          <h5>the reed-veil</h5>
          <p className="flavour">
            {state.wights.veil
              ? 'The reeds stand around your works and the mist stands with them. Every hidden building owes the marsh one, each dawn, while they hold.'
              : 'The reeds lie ready. Raised, they swallow three parts in four of every work’s showing — the fence, the walls, all of it — and the marsh charges by the dawn for the holding.'}
          </p>
          <div className="menu-buttons">
            <button
              title={
                state.wights.veil
                  ? 'The works stand showing again, and the account stops running.'
                  : `fortVisibility ÷ ${MARSH_VEIL_DIV} at every building · +${MARSH_VEIL_DEBT} Debt per hidden building each dawn. Free to raise, free to lower.`
              }
              onClick={() => enqueue({ type: 'setVeil', up: !state.wights.veil })}
            >
              {state.wights.veil ? 'Let the reeds fall' : 'Raise the veil'}
            </button>
          </div>
        </>
      )}
      {tier >= 3 && state.wights.hollowWay === null && (
        <>
          <h5>the way that is not there</h5>
          <div className="menu-buttons">
            {edgesFor(state.farm, state.cuttingHouse)
              .filter((e) => e.id === 'marsh-track' || e.id.startsWith('cut-'))
              .map((e) => (
                <button
                  key={e.id}
                  title="Exposure nothing; the blue coat never sees it; every laden crossing owes a favour."
                  onClick={() => enqueue({ type: 'designateHollowWay', edgeId: e.id })}
                >
                  Open the hollow way through {e.name.toLowerCase()}
                </button>
              ))}
          </div>
        </>
      )}
      {state.wights.hollowWay !== null && (
        <p className="flavour">
          The hollow way runs where{' '}
          {edgesFor(state.farm, state.cuttingHouse)
            .find((e) => e.id === state.wights.hollowWay)
            ?.name.toLowerCase() ?? 'a track'}{' '}
          used to. Nobody watches it, and it is never free.
        </p>
      )}
    </>
  );
}


export function OfficerMenu({ state }: { state: GameState }) {
  const officer = state.revenue.officer;
  const riding = officer.location.kind === 'edge';
  const bound =
    officer.targetNodeId && officer.targetNodeId !== 'customs'
      ? nodeById(officer.targetNodeId, state.farm, state.cuttingHouse).name
      : null;
  return (
    <>
      <h4>The Riding Officer</h4>
      <p className="flavour">
        {riding
          ? `On the road, sitting his horse like a writ.${bound ? ` Bound, by the look of it, for ${bound}.` : ''}`
          : officer.location.kind === 'node' && officer.location.nodeId === 'customs'
            ? 'At his lodgings above the Customs House, writing. Always writing.'
            : 'Dismounted, and looking at things the way he looks at everything: twice.'}
      </p>
      <p className="flavour">He is paid to notice. The parish notices him back — that much is free.</p>
    </>
  );
}


export function ForfeitOverlay() {
  const requestNewGame = useGameStore((s) => s.requestNewGame);
  return (
    <div className="forfeit">
      <div className="forfeit-card">
        <h2>The tenancy is forfeit.</h2>
        <p>
          The agent's men drove off the last of the flock at dawn. The Gault keeps no one who
          cannot pay.
        </p>
        <button onClick={requestNewGame}>Begin again</button>
      </div>
    </div>
  );
}
