import './phone.css';
import { useGameStore } from '../state/store';
import { BattlePlayback } from '../shared/BattlePlayback';
import { BottomBar } from './BottomBar';
import { EventCard } from './EventCard';
import { EventLog } from './EventLog';
import { GameMap } from './GameMap';
import { Hud } from './Hud';
import { LedgerPanel } from './LedgerPanel';
import { useGameLoop } from '../shared/useGameLoop';

// The clean-sheet shell (§20): no header — the map IS the screen, and every
// piece of chrome floats over it. The title lives on the new-game card.
export default function PhoneApp() {
  useGameLoop();
  const state = useGameStore((s) => s.state);

  return (
    <div className="app">
      <div className="map-wrap">
        <GameMap state={state} />
        <Hud state={state} />
        <div className="log-float">
          <EventLog state={state} />
        </div>
        <LedgerPanel state={state} />
        <BottomBar state={state} />
        <EventCard />
        <BattlePlayback />
      </div>
    </div>
  );
}
