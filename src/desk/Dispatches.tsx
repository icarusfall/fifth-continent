// DISPATCHES and the pause beats (spec §20.4). On the desk most of the game's
// cards become slips pinned at the top of the table: read them or don't, the
// clock runs on. The beats the spec names as pauses still stop the world and
// ask for a click — the rent, a raid and its muster, Leiden at the door, his
// letter, a seizure, sheep distrained, a person taken (design taste: an attack
// from any faction is "definitely a pause"; the first rent is an act).

import { useEffect } from 'react';
import { MAX_SUPPRESSIONS, SUPPRESS_STANDING } from '../sim/balance';
import { publicationRiseFor } from '../sim/leiden';
import { rentAmount } from '../sim/tick';
import type { Difficulty, NodeId } from '../sim/types';
import { useGameStore } from '../state/store';
import { useDeskUi } from './deskUi';
import { tideHold } from './idle';
import { spanOf } from '../shared/format';
import { handOf } from './sheets/cart';

/** Hired hands' tide holds are told once a session; they know the marsh. */
const toldHands = new Set<string>();

/**
 * Caught by the tide (desk playtest, 2026-10-03): the moment a hauler halts
 * on a drowned way, a slip says so — what happened, that nothing is lost,
 * when it clears, and how to miss it next time.
 */
function useTideSlips() {
  const pushSlip = useDeskUi((s) => s.pushSlip);
  useEffect(() => {
    let held = new Set<string>();
    let seed = -1;
    return useGameStore.subscribe((st) => {
      const s = st.state;
      const now = new Set<string>();
      for (const cart of s.carts) {
        const h = tideHold(s, cart);
        if (!h) continue;
        now.add(cart.id);
        if (held.has(cart.id) || seed !== s.seed) continue;
        if (cart.carter) {
          if (toldHands.has(cart.id)) continue;
          toldHands.add(cart.id);
        }
        pushSlip(
          h.why === 'flood'
            ? {
                id: `tide-${cart.id}-${s.tick}`,
                title: 'Caught by the tide',
                body: `${cart.carter ? `The ${handOf(cart)} with ${cart.name.toLowerCase()}` : cart.name} was on ${h.road.toLowerCase()} when the sea came over it. It waits on high ground, nothing lost, and goes on when the water drops, in ${spanOf(h.clears)}. The high road never floods; the strip along the bottom shows when the low road will.`,
              }
            : {
                id: `tide-${cart.id}-${s.tick}`,
                title: 'Too little water',
                body: `${cart.name} waits mid-channel on ${h.road}: the tub wants more tide under the keel. It goes on in ${spanOf(h.clears)}.`,
              },
        );
      }
      held = now;
      seed = s.seed;
    });
  }, [pushSlip]);
}

/** Info cards that still stop the clock on the desk. */
const PAUSE_PREFIXES = ['muster-', 'seizure-', 'distraint-', 'collected-', 'breach-'];
const SLIP_MS = 14000;

function isPause(id: string, kind: string): boolean {
  return kind !== 'info' || PAUSE_PREFIXES.some((p) => id.startsWith(p));
}

export function Dispatches() {
  const card = useGameStore((s) => s.activeCard);
  const dismissCard = useGameStore((s) => s.dismissCard);
  const slips = useDeskUi((s) => s.slips);
  const pushSlip = useDeskUi((s) => s.pushSlip);
  const dropSlip = useDeskUi((s) => s.dropSlip);
  useTideSlips();

  // An info card that is not a pause beat becomes a slip, and the world runs on.
  useEffect(() => {
    if (!card || isPause(card.id, card.kind)) return;
    pushSlip({ id: card.id, title: card.title, body: card.body });
    dismissCard();
  }, [card, pushSlip, dismissCard]);

  // Slips fade on their own; a click takes one away sooner.
  useEffect(() => {
    if (slips.length === 0) return;
    const t = window.setInterval(() => {
      const now = Date.now();
      for (const s of useDeskUi.getState().slips) if (now - s.born > SLIP_MS) dropSlip(s.id);
    }, 1000);
    return () => window.clearInterval(t);
  }, [slips.length, dropSlip]);

  return (
    <div className="dispatches" aria-live="polite">
      {slips.map((s, i) => (
        <button
          key={s.id}
          className="slip"
          style={{ ['--r' as string]: `${((i * 37) % 7) / 6 - 0.5}deg` }}
          title="Click to put it away"
          onClick={() => dropSlip(s.id)}
        >
          <b>{s.title}</b>
          <span>{s.body}</span>
        </button>
      ))}
    </div>
  );
}

const DIFFICULTY_CHOICE: Array<{ value: Difficulty; label: string; note: string }> = [
  { value: 'gentle', label: 'Gentle', note: 'the marsh is kind to newcomers' },
  { value: 'fair', label: 'Fair', note: 'the game as designed' },
  { value: 'hard', label: 'Hard', note: 'for those who have smuggled before' },
];

/** The pause beats: the card that stops the world until it is answered. */
export function PauseCard() {
  const card = useGameStore((s) => s.activeCard);
  const state = useGameStore((s) => s.state);
  const autoPayRent = useGameStore((s) => s.autoPayRent);
  const payRent = useGameStore((s) => s.payRent);
  const takeLoan = useGameStore((s) => s.takeLoan);
  const setAutoPayRent = useGameStore((s) => s.setAutoPayRent);
  const dismissCard = useGameStore((s) => s.dismissCard);
  const startBattle = useGameStore((s) => s.startBattle);
  const startNewGame = useGameStore((s) => s.startNewGame);
  const waitAgain = useGameStore((s) => s.waitAgain);
  const answerLeiden = useGameStore((s) => s.answerLeiden);
  const answerLetter = useGameStore((s) => s.answerLetter);

  if (!card || !isPause(card.id, card.kind)) return null;
  const due = rentAmount(state);
  const loanOffered = card.kind === 'rent' && state.coin < due && state.dutchman.unlocked && state.dutchmanBook <= 0;

  return (
    <div className="pause-scrim">
      <div className="pause-card" role="dialog" aria-label={card.title}>
        <div className="kicker">the clock stops</div>
        <h2>{card.title}</h2>
        {card.flavour && <p className="pause-flavour">{card.flavour}</p>}
        {card.body.split('\n\n').map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        <div className="pause-acts">
          {card.kind === 'rent' ? (
            <>
              <button className="primary" onClick={payRent}>
                {state.coin >= due ? `Pay the rent · ${due} coin` : 'Pay what the purse holds'}
              </button>
              {loanOffered && (
                <button className="primary danger" onClick={takeLoan}>
                  Take the Dutchman’s coin — his book, his vig
                </button>
              )}
              <label className="check">
                <input type="checkbox" checked={autoPayRent} onChange={(e) => setAutoPayRent(e.target.checked)} />
                Pay future rents without asking
              </label>
            </>
          ) : card.kind === 'raid' ? (
            <button className="primary danger" onClick={startBattle}>
              See it through
            </button>
          ) : card.kind === 'leiden' ? (
            <>
              {(['farm', ...(state.cuttingHouse ? ['cutting-house'] : [])] as NodeId[]).map((nodeId) => (
                <button key={nodeId} className="primary" onClick={() => answerLeiden(nodeId)}>
                  House him in the loft at {nodeId === 'farm' ? 'Walland Farm' : 'the Cutting House'}
                </button>
              ))}
              <button className="secondary" onClick={() => answerLeiden(null)}>
                Turn him away — the sea can have him back
              </button>
            </>
          ) : card.kind === 'letter' ? (
            <>
              <button className="primary" onClick={() => answerLetter(true)}>
                Send the letter · +{Math.round(publicationRiseFor(state, state.leiden.letterPending ?? 0))} to
                the floor under London’s memory, for ever
              </button>
              <button
                className="secondary"
                disabled={state.leiden.heldLetters.length >= MAX_SUPPRESSIONS}
                onClick={() => answerLetter(false)}
              >
                {state.leiden.heldLetters.length >= MAX_SUPPRESSIONS
                  ? 'He will not stand a fourth letter held. This one goes out.'
                  : `The strongbox · −${SUPPRESS_STANDING} Standing`}
              </button>
            </>
          ) : card.kind === 'vigil' ? (
            <>
              <button className="primary" onClick={waitAgain}>
                Wait the next night out · let the hours run
              </button>
              <button className="secondary" onClick={dismissCard}>
                Go on — there is work by daylight
              </button>
            </>
          ) : card.kind === 'newGame' ? (
            <>
              {DIFFICULTY_CHOICE.map((d) => (
                <button key={d.value} className="primary" onClick={() => startNewGame(d.value)}>
                  {d.label} — {d.note}
                </button>
              ))}
              <button className="secondary" onClick={dismissCard}>
                Stay with this game
              </button>
            </>
          ) : (
            <button className="primary" onClick={dismissCard}>
              Go on
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
