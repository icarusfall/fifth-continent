# The phone as a management sim: task list

Status: **planning only, nothing built** (2026-10-03). The desk's look and
feel comes first. This file is the agenda for when the phone work starts.

Goal: the phone is the quick game, played in a spare five minutes. It should
feel like a management sim made of dashboards, cards, rows and timers, with
almost no scrolling and no pinch-zooming. The map becomes something you glance
at, not the screen you work in.

## P0: decisions before any code

- [ ] **Unfreeze `src/phone`.** CLAUDE.md and spec §20.3 freeze it to bug
      fixes. Lifting that is a deliberate decision, recorded in both files.
- [ ] **Reconcile with §20's rules.** "The map is the truth" and "no modal
      management screens" bind both shells. A dashboard-first phone bends
      the first rule. Decide whether the phone gets its own exception (like
      the Ledger's, §20.1), and say where the map stays authoritative: the
      overview tab, and the place a card points to.
- [ ] **Rebuild in place, or build a third shell beside the old one?**
      (Leaning: build `src/phone2` behind `?phone2` until it is ready, so the
      current phone stays playable.)
- [ ] **Write spec §20.5, "The pocket ledger".** Layout, gestures and stages,
      in the house style, before any code.

## P1: foundations

- [ ] **Shared sheets.** Move `src/desk/sheet.ts` and `src/desk/sheets/*`
      (verbs as data) to `src/shared` so both shells render the same verbs.
      Every new mechanic then reaches both, and the phone inherits the lit
      NEXT step and the empty-cart gate.
- [ ] Shared `routes.ts` / `command.ts` helpers that aren't desk-specific
      (waysFor, routeRisk, sendByRoute, draft rounds).
- [ ] Shared `idle.ts` (why a hand stands still) and `dayAhead.ts` (the day strip).
- [ ] A phone card renderer for a Sheet: big tap targets, the charge on the
      button, the "why" behind a tap-to-expand, not a hover.

## P2: the screens

- [ ] **Home dashboard, one screen and no scroll.** Rent due and coin; the
      tide and the clock; a compact day strip; a "needs you" list of three to
      five items (idle cart, full barn, lugger standing off, rent close), each
      a tap straight to the right card.
- [ ] **Bottom tabs, in thumb reach.** Home · Carts · Places · Ledger · Map.
- [ ] **Carts tab.** One row per cart: name, cargo chips (white/dark wool),
      where it is, a progress bar along its road, the hand's idle reason.
      Tap a row to open its card.
- [ ] **Send flow without a map.** Cart card → destination cards (Ryne by the
      low road: 1.5h, drowns at high water…) → tap. One thumb, two taps.
- [ ] **Rounds (standing orders) as a list builder.** Add stops from cards,
      choose what each stop takes, hire the hand.
- [ ] **Places tab.** The farm, Ryne, the shingle, the cutting house and the
      works as cards, using the same sheets as the desk.
- [ ] **Ledger tab.** The square/short switch and the white/dark wool split,
      sized for a phone.
- [ ] **Map tab.** A fixed overview of the whole marsh at one zoom, with no
      pan or pinch. Carts as dots, places tappable to open their card. It
      can reuse the desk's painted terrain at low resolution.

## P3: the five-minute session

- [ ] **"While you were away".** Opening the app summarises what happened
      since the last visit: sales, seizures, rent, idle hands.
- [ ] Event cards stay, but are quieter and queued, never stacked.
- [ ] Speed controls and pause sized for a thumb. Decide whether the phone
      auto-pauses when backgrounded.
- [ ] The first morning on the phone, through the shared thread
      (`src/shared/firstMorning.ts`) and lit NEXT steps.

## P4: checks

- [ ] No horizontal scroll at 360px; every tap target at least 44px.
- [ ] One-handed reach audit: primary verbs in the bottom half.
- [ ] Battles (BattlePlayback) still readable at phone width.
- [ ] A playtest on a real phone, then tuning.

## Open questions for the designer

- Does the phone keep real-time play, or lean towards "set orders, come back
  later"? This changes how big "while you were away" needs to be.
- Should the Map tab let you send carts at all, or stay view-only?
- One save across both shells (as now)? Assumed yes.
