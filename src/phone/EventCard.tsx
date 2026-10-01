// Spec §6.13 — the auto-pause event card. The store raises a card at a
// card-worthy moment and freezes the world (useGameLoop); this overlay is how
// the player answers it. The sim knows nothing of any of this (house rule 1).

import { MAX_SUPPRESSIONS, SUPPRESS_STANDING } from '../sim/balance';
import { publicationRiseFor } from '../sim/leiden';
import { rentAmount } from '../sim/tick';
import type { Difficulty, NodeId } from '../sim/types';
import { useGameStore } from '../state/store';

const DIFFICULTY_CHOICE: Array<{ value: Difficulty; label: string; note: string }> = [
  { value: 'gentle', label: 'Gentle', note: 'the marsh is kind to newcomers' },
  { value: 'fair', label: 'Fair', note: 'the game as designed' },
  { value: 'hard', label: 'Hard', note: 'for those who have smuggled before' },
];

export function EventCard() {
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

  if (!card) return null;

  // §6.15 — the Dutchman's coin is on the table only when the purse is short,
  // he knows your name, and his book is closed. Mercy is a button, not a gift.
  const due = rentAmount(state);
  const loanOffered =
    card.kind === 'rent' && state.coin < due && state.dutchman.unlocked && state.dutchmanBook <= 0;

  return (
    <div className="event-scrim">
      <div className="event-card">
        <h2>{card.title}</h2>
        {card.flavour && <p className="event-flavour">{card.flavour}</p>}
        {/* A card may argue in more than one breath (§6.14's letter): blank
            lines are paragraphs, and every other card has none. */}
        {card.body.split('\n\n').map((para, i) => (
          <p key={i}>{para}</p>
        ))}

        {card.kind === 'rent' ? (
          <>
            <button className="event-primary" onClick={payRent}>
              {state.coin >= due ? `Pay the rent · ${due} coin` : 'Pay what the purse holds'}
            </button>
            {loanOffered && (
              <button className="event-primary event-danger" onClick={takeLoan}>
                Take the Dutchman's coin — his book, his vig
              </button>
            )}
            <label className="event-check">
              <input
                type="checkbox"
                checked={autoPayRent}
                onChange={(e) => setAutoPayRent(e.target.checked)}
              />
              Pay future rents without asking
            </label>
          </>
        ) : card.kind === 'raid' ? (
          <button className="event-primary event-danger" onClick={startBattle}>
            See it through
          </button>
        ) : card.kind === 'leiden' ? (
          <>
            {/* §6.14 (M5½ playtest) — he takes the loft, not the hides: no
                cover arithmetic, no disabled buttons. The choice is only
                where the letters will be written from. */}
            {(['farm', ...(state.cuttingHouse ? ['cutting-house'] : [])] as NodeId[]).map(
              (nodeId) => (
                <button
                  key={nodeId}
                  className="event-primary"
                  title="He, the glass, and the smell of burning air go up under the roof; the brandy keeps the dark below. The building becomes the workshop."
                  onClick={() => answerLeiden(nodeId)}
                >
                  House him in the loft at{' '}
                  {nodeId === 'farm' ? 'Walland Farm' : 'the Cutting House'}
                </button>
              ),
            )}
            <button className="event-check" onClick={() => answerLeiden(null)}>
              Turn him away — the sea can have him back
            </button>
          </>
        ) : card.kind === 'letter' ? (
          <>
            {/* §6.14 (M5½ playtest) — read the charge: the one permanent
                cost in the game states its number on the button that pays it. */}
            <button
              className="event-primary"
              title="National Heat is the clock that barely forgets. Print gives it a minimum it can never decay below — and the Crown musters off that meter."
              onClick={() => answerLetter(true)}
            >
              Send the letter · +
              {Math.round(publicationRiseFor(state, state.leiden.letterPending ?? 0))} to the floor
              under London&rsquo;s memory, for ever
            </button>
            <button
              className="event-check"
              disabled={state.leiden.heldLetters.length >= MAX_SUPPRESSIONS}
              title={
                state.leiden.heldLetters.length >= MAX_SUPPRESSIONS
                  ? 'He will not stand a fourth letter held. This one goes out.'
                  : 'He is slighted before a parish that likes him.'
              }
              onClick={() => answerLetter(false)}
            >
              The strongbox · −{SUPPRESS_STANDING} Standing
            </button>
          </>
        ) : card.kind === 'vigil' ? (
          <>
            <button className="event-primary" onClick={waitAgain}>
              Wait the next night out · let the hours run
            </button>
            <button className="event-check" onClick={dismissCard}>
              Go on — there is work by daylight
            </button>
          </>
        ) : card.kind === 'newGame' ? (
          <>
            {DIFFICULTY_CHOICE.map((d) => (
              <button
                key={d.value}
                className="event-primary"
                onClick={() => startNewGame(d.value)}
              >
                {d.label} — {d.note}
              </button>
            ))}
            <button className="event-check" onClick={dismissCard}>
              Stay with this game
            </button>
          </>
        ) : (
          <button className="event-primary" onClick={dismissCard}>
            Go on
          </button>
        )}
      </div>
    </div>
  );
}
