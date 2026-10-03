// THE INSPECTOR (spec §20.4): the right-hand panel, where the selection's
// verbs live. Facts first; then verbs, each with its charge on its face, its
// reason shown when it cannot be done (never a tooltip), and its "what for"
// folded beneath it. One renderer for every sheet.

import { useGameStore } from '../state/store';
import { useDeskUi } from './deskUi';
import { sheetFor } from './sheets';
import { RoundDraft } from './RoundDraft';
import type { Line, Run, Sheet, Verb } from './sheet';
import { nodeById } from '../sim/map';
import { legOpen } from './routes';

function LineView({ line }: { line: Line }) {
  return <p className={`fact${line.tone ? ` ${line.tone}` : ''}`}>{line.text}</p>;
}

function Fill({ count, cap }: { count: number; cap: number }) {
  const pct = Math.min(1, cap > 0 ? count / cap : 0);
  return (
    <div className="fill" title={`${count} of ${cap}`}>
      <i style={{ width: `${pct * 100}%`, background: `hsl(${Math.round(120 * (1 - pct))} 45% 45%)` }} />
    </div>
  );
}

function VerbRow({ verb, sectionKey, run }: { verb: Verb; sectionKey: string; run: (r: Run) => void }) {
  const key = `${sectionKey}:${verb.key}`;
  const open = useDeskUi((s) => !!s.whyOpen[key]);
  const toggle = useDeskUi((s) => s.toggleWhy);
  return (
    <div className={`verb${verb.blocked ? ' blocked' : ''}${verb.danger ? ' danger' : ''}${verb.primary && !verb.blocked ? ' primary' : ''}`}>
      <div className="verb-row">
        <button className="verb-btn" disabled={!!verb.blocked} onClick={() => run(verb.run)}>
          <span className="verb-label">
            {verb.primary && !verb.blocked && <em className="next">next</em>}
            {verb.label}
          </span>
          {verb.charge && <span className="verb-charge">{verb.charge}</span>}
        </button>
        {verb.why && (
          <button
            className={open ? 'why-btn on' : 'why-btn'}
            aria-expanded={open}
            aria-label={`What ${verb.label} is for`}
            onClick={() => toggle(key)}
          >
            ?
          </button>
        )}
      </div>
      {verb.blocked && <p className="verb-reason">{verb.blocked}</p>}
      {open && verb.why && <p className="verb-why">{verb.why}</p>}
    </div>
  );
}

export function SheetView({ sheet, run }: { sheet: Sheet; run: (r: Run) => void }) {
  return (
    <>
      <header className="sheet-head">
        <div className="kicker">{sheet.kicker}</div>
        <h2>{sheet.title}</h2>
      </header>
      <div className="sheet-body">
        {sheet.lines.map((l, i) => (
          <LineView key={i} line={l} />
        ))}
        {sheet.fill && <Fill {...sheet.fill} />}
        {sheet.sections.map((s) => (
          <section key={s.key} className="sheet-section">
            {s.title && <h3>{s.title}</h3>}
            {s.lines.map((l, i) => (
              <LineView key={i} line={l} />
            ))}
            {s.fill && <Fill {...s.fill} />}
            {s.verbs.length > 0 && (
              <div className="verbs">
                {s.verbs.map((v) => (
                  <VerbRow key={v.key} verb={v} sectionKey={s.key} run={run} />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}

/** A cart being driven road by road: where it is bound, and what it waits on. */
function JourneyNote({ cartId }: { cartId: string }) {
  const j = useDeskUi((s) => s.journeys[cartId]);
  const state = useGameStore((s) => s.state);
  const setJourney = useDeskUi((s) => s.setJourney);
  if (!j) return null;
  const leg = j.route.legs[j.next];
  const waiting = leg && !legOpen(state, leg);
  return (
    <div className="journey">
      <span>
        Bound for {nodeById(j.to, state.farm, state.cuttingHouse).name}
        {leg ? `, then ${leg.edge.name.toLowerCase()}` : ''}
        {waiting ? ' — waits on the tide' : ''}.
      </span>
      <button onClick={() => setJourney(cartId, null)}>Stop when he gets there</button>
    </div>
  );
}

export function Inspector() {
  const state = useGameStore((s) => s.state);
  const waiting = useGameStore((s) => s.waitingForLugger);
  const enqueue = useGameStore((s) => s.enqueue);
  const setWaiting = useGameStore((s) => s.setWaitingForLugger);
  const soundTheAlarm = useGameStore((s) => s.soundTheAlarm);
  const selection = useDeskUi((s) => s.selection);
  const select = useDeskUi((s) => s.select);
  const setPlacing = useDeskUi((s) => s.setPlacing);

  const paused = useGameStore((s) => s.paused);
  const queued = useGameStore((s) => s.pending.length);
  const setPaused = useGameStore((s) => s.setPaused);
  const sheet = selection ? sheetFor(selection, state, waiting) : null;
  // A cart standing at a place shows the place's own verbs beneath it (desk
  // playtest, 2026-10-03): at the farm the shears, at Ryne the alehouse. The
  // cart and the place it stands in are one visit.
  const selCart = selection?.kind === 'cart' ? state.carts.find((c) => c.id === selection.id) : null;
  const placeAt = selCart?.location.kind === 'node' ? selCart.location.nodeId : null;
  const placeFull = placeAt ? sheetFor({ kind: 'place', id: placeAt }, state, waiting) : null;
  const placeUnder = placeFull
    ? { ...placeFull, sections: placeFull.sections.filter((s) => !s.key.startsWith('carts-')) }
    : null;

  const run = (r: Run) => {
    if ('action' in r) {
      enqueue(r.action);
      return;
    }
    switch (r.ui) {
      case 'place-cutting-house':
        setPlacing(true);
        return;
      case 'wait-lugger':
        setWaiting(r.on);
        return;
      case 'sound-alarm':
        soundTheAlarm();
        return;
      case 'select':
        select(r.target, true);
        return;
    }
  };

  return (
    <aside className="panel inspector" aria-label="Selection">
      {paused && queued > 0 && (
        <button className="queued" onClick={() => setPaused(false)}>
          Paused — {queued} order{queued === 1 ? '' : 's'} wait{queued === 1 ? 's' : ''} for the clock. Run it.
        </button>
      )}
      {sheet ? (
        <>
          <button className="panel-close" aria-label="Let go" onClick={() => select(null)}>
            ×
          </button>
          {selection?.kind === 'cart' && <JourneyNote cartId={selection.id} />}
          {selection?.kind === 'cart' && <RoundDraft />}
          <SheetView sheet={sheet} run={run} />
          {placeUnder && (
            <div className="place-under">
              <SheetView sheet={placeUnder} run={run} />
            </div>
          )}
        </>
      ) : (
        <div className="sheet-body idle">
          <div className="kicker">the table</div>
          <p className="fact">Click a place or a cart on the map, or a cart in the stable.</p>
          <p className="fact quiet">
            <kbd>1</kbd>–<kbd>9</kbd> pick a cart · <kbd>L</kbd> the ledger · <kbd>Space</kbd> pauses ·{' '}
            <kbd>Esc</kbd> lets go
          </p>
        </div>
      )}
    </aside>
  );
}
