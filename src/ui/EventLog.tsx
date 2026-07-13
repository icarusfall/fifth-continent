import { clockOf } from '../sim/time';
import type { GameState } from '../sim/types';

export function EventLog({ state }: { state: GameState }) {
  const recent = state.log.slice(-9).reverse();
  return (
    <div className="event-log">
      {recent.map((e, i) => {
        const c = clockOf(e.tick);
        return (
          <div key={`${e.tick}-${i}`} className="event" style={{ opacity: 1 - i * 0.09 }}>
            <span className="event-time">
              d{c.day} {String(c.hour).padStart(2, '0')}:{String(c.minute).padStart(2, '0')}
            </span>{' '}
            {e.text}
          </div>
        );
      })}
    </div>
  );
}
