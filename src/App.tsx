import { useGameStore } from './state/store';
import { EventCard } from './ui/EventCard';
import { EventLog } from './ui/EventLog';
import { GameMap } from './ui/GameMap';
import { Hud } from './ui/Hud';
import { SpeedControls } from './ui/SpeedControls';
import { useGameLoop } from './ui/useGameLoop';

export default function App() {
  useGameLoop();
  const state = useGameStore((s) => s.state);

  return (
    <div className="app">
      <header>
        <h1>The Fifth Continent</h1>
        <Hud state={state} />
        <SpeedControls />
      </header>

      <div className="map-wrap">
        <GameMap state={state} />
        <div className="log-float">
          <EventLog state={state} />
        </div>
        <EventCard />
      </div>
    </div>
  );
}
