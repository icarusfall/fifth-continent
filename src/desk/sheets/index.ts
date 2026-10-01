import type { GameState } from '../../sim/types';
import type { DeskSelection, Sheet } from '../sheet';
import { cartSheet } from './cart';
import { ledgerSheet } from './ledger';
import { dykeSheet, officerSheet, signSheet, stoneSheet } from './marsh';
import { customsSheet, cuttingHouseSheet, farmSheet, ryneSheet, shingleSheet } from './places';

/** Whatever is selected, as a sheet — or null when it no longer exists. */
export function sheetFor(sel: DeskSelection, state: GameState, waitingForLugger: boolean): Sheet | null {
  switch (sel.kind) {
    case 'place':
      switch (sel.id) {
        case 'farm':
          return farmSheet(state);
        case 'ryne':
          return ryneSheet(state);
        case 'shingle':
          return state.dutchman.unlocked ? shingleSheet(state, waitingForLugger) : null;
        case 'cutting-house':
          return state.cuttingHouse ? cuttingHouseSheet(state) : null;
        case 'customs':
          return customsSheet(state);
        default:
          return null;
      }
    case 'cart':
      return cartSheet(state, sel.id);
    case 'dyke':
      return state.cuttingHouse ? dykeSheet(state, sel.id) : null;
    case 'sign':
      return state.wights.sign ? signSheet(state) : null;
    case 'stone':
      return state.wights.stone ? stoneSheet(state) : null;
    case 'officer':
      return state.revenue.officer.arrived ? officerSheet(state) : null;
    case 'ledger':
      return ledgerSheet(state);
  }
}
