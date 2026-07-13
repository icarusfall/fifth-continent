import { CART_CAPACITY } from '../sim/balance';
import { EDGES, nodeById } from '../sim/map';
import { isFlooded } from '../sim/time';
import type { GameState } from '../sim/types';
import { useGameStore } from '../state/store';

export function Controls({ state }: { state: GameState }) {
  const enqueue = useGameStore((s) => s.enqueue);
  const pending = useGameStore((s) => s.pending);
  const cart = state.carts[0];
  const atNode = cart.location.kind === 'node' ? cart.location.nodeId : null;
  const held = cart.cargo.fleece ?? 0;
  const atFarmFleece = state.stores.farm?.fleece ?? 0;
  const flooded = isFlooded(state.tick);

  const queued = (predicate: (a: (typeof pending)[number]) => boolean) => pending.some(predicate);

  return (
    <div className="controls">
      <h3>
        {cart.name} — {held}/{CART_CAPACITY} fleece
      </h3>
      <p className="whereabouts">
        {atNode
          ? `standing at ${nodeById(atNode).name}`
          : 'on the road'}
      </p>

      <div className="button-row">
        <button
          disabled={atNode !== 'farm' || atFarmFleece <= 0 || held >= CART_CAPACITY}
          onClick={() =>
            enqueue({ type: 'loadCart', cartId: cart.id, good: 'fleece', qty: CART_CAPACITY })
          }
        >
          Load fleece
        </button>
        <button
          disabled={atNode !== 'ryne' || held <= 0 || queued((a) => a.type === 'sell')}
          onClick={() => enqueue({ type: 'sell', cartId: cart.id, good: 'fleece' })}
        >
          Sell at Ryne
        </button>
      </div>

      <div className="button-row">
        {EDGES.map((edge) => {
          const tideBlocked = edge.condition === 'tideLocked' && flooded;
          return (
            <button
              key={edge.id}
              disabled={!atNode || tideBlocked || queued((a) => a.type === 'dispatchCart')}
              title={
                tideBlocked
                  ? 'Under water until the tide falls.'
                  : `${edge.latency} ticks. ${edge.id === 'high-road' ? 'Passes the Customs House.' : 'Short, when the sea allows.'}`
              }
              onClick={() => enqueue({ type: 'dispatchCart', cartId: cart.id, edgeId: edge.id })}
            >
              {edge.name}
              {tideBlocked ? ' 🌊' : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SpeedControls() {
  const paused = useGameStore((s) => s.paused);
  const setPaused = useGameStore((s) => s.setPaused);
  const speed = useGameStore((s) => s.ticksPerSecond);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const save = useGameStore((s) => s.save);
  const reset = useGameStore((s) => s.reset);

  return (
    <div className="speed-controls">
      <button onClick={() => setPaused(!paused)}>{paused ? '▶ Resume' : '⏸ Pause'}</button>
      {[3, 10, 30].map((tps, i) => (
        <button
          key={tps}
          className={speed === tps && !paused ? 'active' : ''}
          onClick={() => {
            setSpeed(tps);
            setPaused(false);
          }}
        >
          {'▶'.repeat(i + 1)}
        </button>
      ))}
      <span className="spacer" />
      <button onClick={save}>Save</button>
      <button
        onClick={() => {
          if (window.confirm('Abandon this game and start over?')) reset();
        }}
      >
        New game
      </button>
    </div>
  );
}
