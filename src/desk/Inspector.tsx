// THE INSPECTOR (spec §20.4): the right-hand panel, where the selection's
// verbs live. Facts first; then verbs, each with its charge on its face, its
// reason shown when it cannot be done (never a tooltip), and its "what for"
// folded beneath it. One renderer for every sheet.

import { useGameStore } from '../state/store';
import { useDeskUi } from './deskUi';
import { sheetFor } from './sheets';
import type { Line, Run, Sheet, Verb } from './sheet';

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
    <div className={`verb${verb.blocked ? ' blocked' : ''}${verb.danger ? ' danger' : ''}`}>
      <div className="verb-row">
        <button className="verb-btn" disabled={!!verb.blocked} onClick={() => run(verb.run)}>
          <span className="verb-label">{verb.label}</span>
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
          <SheetView sheet={sheet} run={run} />
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
