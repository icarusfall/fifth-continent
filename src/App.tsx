import { useGameStore } from './state/store';
import { BattlePlayback } from './ui/BattlePlayback';
import { BottomBar } from './ui/BottomBar';
import { EventCard } from './ui/EventCard';
import { EventLog } from './ui/EventLog';
import { GameMap } from './ui/GameMap';
import { Hud } from './ui/Hud';
import { LedgerPanel } from './ui/LedgerPanel';
import { useGameLoop } from './ui/useGameLoop';

// The clean-sheet shell (§20): no header — the map IS the screen, and every
// piece of chrome floats over it. The title lives on the new-game card.
export default function App() {
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
