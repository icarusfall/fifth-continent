import { useMemo } from 'react';
import { EDGES, MAP_HEIGHT, MAP_WIDTH, NODES, TERRAIN, edgeById } from '../sim/map';
import { dayPhaseOf, isFlooded } from '../sim/time';
import type { GameState } from '../sim/types';
import { pathPoints, pointAlong, svgPath, TILE, tileCenter } from './geometry';
import { CLAY, DYKE, INK, LIMEWASH, TERRAIN_FILL } from './palette';

/** Merge each terrain row into horizontal run-length rects (SVG stays light). */
function terrainRects(): Array<{ x: number; y: number; w: number; fill: string }> {
  const rects: Array<{ x: number; y: number; w: number; fill: string }> = [];
  TERRAIN.forEach((row, y) => {
    let runStart = 0;
    for (let x = 1; x <= row.length; x++) {
      if (x === row.length || row[x] !== row[runStart]) {
        rects.push({ x: runStart, y, w: x - runStart, fill: TERRAIN_FILL[row[runStart]] });
        runStart = x;
      }
    }
  });
  return rects;
}

export function MapView({ state }: { state: GameState }) {
  const rects = useMemo(terrainRects, []);
  const flooded = isFlooded(state.tick);
  const phase = dayPhaseOf(state.tick);
  const nightOpacity = phase === 'night' ? 0.38 : phase === 'dusk' ? 0.18 : 0;

  return (
    <svg
      viewBox={`0 0 ${MAP_WIDTH * TILE} ${MAP_HEIGHT * TILE}`}
      style={{ width: '100%', height: 'auto', display: 'block', background: INK }}
    >
      {/* terrain */}
      {rects.map((r, i) => (
        <rect key={i} x={r.x * TILE} y={r.y * TILE} width={r.w * TILE} height={TILE} fill={r.fill} />
      ))}

      {/* roads */}
      {EDGES.map((edge) => {
        const pts = pathPoints(edge, false);
        const isLow = edge.condition === 'tideLocked';
        const drowned = isLow && flooded;
        return (
          <g key={edge.id}>
            <path
              d={svgPath(pts)}
              fill="none"
              stroke={INK}
              strokeWidth={7}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.55}
            />
            <path
              d={svgPath(pts)}
              fill="none"
              stroke={drowned ? DYKE : CLAY}
              strokeWidth={4}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={drowned ? '4 6' : undefined}
            />
          </g>
        );
      })}

      {/* nodes */}
      {NODES.map((node) => {
        const c = tileCenter(node);
        return (
          <g key={node.id}>
            <rect
              x={c.x - 7}
              y={c.y - 7}
              width={14}
              height={14}
              fill={node.kind === 'customs' ? LIMEWASH : TERRAIN_FILL.t}
              stroke={INK}
              strokeWidth={2}
            />
            <text
              x={c.x}
              y={c.y - 12}
              textAnchor="middle"
              fontSize={11}
              fontFamily="Georgia, serif"
              fill={LIMEWASH}
              stroke={INK}
              strokeWidth={3}
              paintOrder="stroke"
            >
              {node.name}
            </text>
          </g>
        );
      })}

      {/* the flock — decorative, but honest about where the wool comes from */}
      {Array.from({ length: state.flockSize }, (_, i) => {
        const sx = (6.2 + (i % 4) * 1.9) * TILE;
        const sy = (12.8 + Math.floor(i / 4) * 0.9) * TILE;
        return <ellipse key={i} cx={sx} cy={sy} rx={5} ry={3.5} fill={LIMEWASH} stroke={INK} strokeWidth={1.5} />;
      })}

      {/* carts */}
      {state.carts.map((cart) => {
        const loc = cart.location;
        let pos: { x: number; y: number };
        if (loc.kind === 'node') {
          const node = NODES.find((n) => n.id === loc.nodeId)!;
          pos = tileCenter({ x: node.x, y: node.y - 0.6 });
        } else {
          const edge = edgeById(loc.edgeId);
          const pts = pathPoints(edge, loc.from !== edge.a);
          pos = pointAlong(pts, loc.progress / edge.latency);
        }
        const laden = (cart.cargo.fleece ?? 0) > 0;
        return (
          <g key={cart.id}>
            <circle cx={pos.x} cy={pos.y} r={6} fill={laden ? LIMEWASH : CLAY} stroke={INK} strokeWidth={2.5} />
            {laden && <circle cx={pos.x} cy={pos.y} r={2.5} fill={INK} />}
          </g>
        );
      })}

      {/* night falls over everything */}
      {nightOpacity > 0 && (
        <rect
          x={0}
          y={0}
          width={MAP_WIDTH * TILE}
          height={MAP_HEIGHT * TILE}
          fill="#1b2433"
          opacity={nightOpacity}
          pointerEvents="none"
        />
      )}
    </svg>
  );
}
