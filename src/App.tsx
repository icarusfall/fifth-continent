import { useGameStore } from './state/store';
import { Controls, SpeedControls } from './ui/Controls';
import { EventLog } from './ui/EventLog';
import { Hud } from './ui/Hud';
import { MapView } from './ui/MapView';
import { useGameLoop } from './ui/useGameLoop';

export default function App() {
  useGameLoop();
  const state = useGameStore((s) => s.state);

  return (
    <div className="app">
      <header>
        <h1>The Fifth Continent</h1>
        <p className="strapline">
          “The world is divided into Europe, Asia, Africa, America — and the Marsh.”
        </p>
      </header>

      <Hud state={state} />

      <main>
        <div className="map-frame">
          <MapView state={state} />
        </div>
        <aside>
          <SpeedControls />
          <Controls state={state} />
          <EventLog state={state} />
        </aside>
      </main>
    </div>
  );
}
