// Which front-end runs this tenancy (spec §20.3): one sim, one store, two
// shells. The phone is the quick game; the desk is the Smuggler's Table.
// UI-only — the choice never touches GameState, so a save moves freely
// between the two.

export type Shell = 'phone' | 'desk';

// The desk joins the automatic choice once it is playable end to end (D2,
// 2026-10-01): a fine pointer on a wide screen gets the table.
export const DESK_READY = true;

const SHELL_KEY = 'fifth-continent-shell';
const DESK_MIN_WIDTH = 1100;

export interface ShellEnv {
  search: string;
  stored: string | null;
  finePointer: boolean;
  width: number;
}

export function chooseShell(env: ShellEnv, deskReady = DESK_READY): Shell {
  const q = new URLSearchParams(env.search);
  if (q.has('desk')) return 'desk';
  if (q.has('phone')) return 'phone';
  if (!deskReady) return 'phone';
  if (env.stored === 'desk' || env.stored === 'phone') return env.stored;
  return env.finePointer && env.width >= DESK_MIN_WIDTH ? 'desk' : 'phone';
}

export function browserShell(): Shell {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(SHELL_KEY);
    // A link that names a shell is a choice: remember it, so it sticks.
    const q = new URLSearchParams(window.location.search);
    if (q.has('desk')) localStorage.setItem(SHELL_KEY, 'desk');
    else if (q.has('phone')) localStorage.setItem(SHELL_KEY, 'phone');
  } catch {
    // blocked storage only costs the remembered preference
  }
  return chooseShell({
    search: window.location.search,
    stored,
    finePointer: window.matchMedia('(pointer: fine)').matches,
    width: window.innerWidth,
  });
}

/** The settings switch: remember a choice and reload into it. */
export function rememberShell(shell: Shell): void {
  try {
    localStorage.setItem(SHELL_KEY, shell);
  } catch {
    /* ignore */
  }
  const url = new URL(window.location.href);
  url.searchParams.delete('desk');
  url.searchParams.delete('phone');
  window.location.replace(url.toString());
}
