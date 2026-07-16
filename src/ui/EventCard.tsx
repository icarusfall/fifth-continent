// Spec §6.13 — the auto-pause event card. The store raises a card at a
// card-worthy moment and freezes the world (useGameLoop); this overlay is how
// the player answers it. The sim knows nothing of any of this (house rule 1).

import { RENT_AMOUNT } from '../sim/balance';
import { useGameStore } from '../state/store';

export function EventCard() {
  const card = useGameStore((s) => s.activeCard);
  const autoPayRent = useGameStore((s) => s.autoPayRent);
  const payRent = useGameStore((s) => s.payRent);
  const setAutoPayRent = useGameStore((s) => s.setAutoPayRent);
  const dismissCard = useGameStore((s) => s.dismissCard);
  const resolveRaid = useGameStore((s) => s.resolveRaid);

  if (!card) return null;

  return (
    <div className="event-scrim">
      <div className="event-card">
        <h2>{card.title}</h2>
        <p>{card.body}</p>

        {card.kind === 'rent' ? (
          <>
            <button className="event-primary" onClick={payRent}>
              Pay the rent · {RENT_AMOUNT} coin
            </button>
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
          <button className="event-primary event-danger" onClick={resolveRaid}>
            See it through
          </button>
        ) : (
          <button className="event-primary" onClick={dismissCard}>
            Go on
          </button>
        )}
      </div>
    </div>
  );
}
