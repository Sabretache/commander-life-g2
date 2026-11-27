// Game model for a Commander life counter + floating mana tracker.
// Pure TypeScript: no DOM or SDK access, so it can be unit tested.

export const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
export type Color = (typeof COLORS)[number];
export const COLOR_NAMES: Record<Color, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};

export const CMD_LETHAL = 21;
export const POISON_LETHAL = 10;
export const MAX_OPPONENTS = 5;

export interface Opponent {
  name: string;
  /** Commander damage this opponent's commander has dealt to you. */
  cmdDmg: number;
}

export interface Game {
  startingLife: number;
  life: number;
  poison: number;
  /** Times you've cast your commander from the command zone. Tax = 2 x casts. */
  casts: number;
  opponents: Opponent[];
  mana: Record<Color, number>;
}

export interface Settings {
  /** Commander damage is also regular damage, so it lowers life too. */
  cmdDmgAffectsLife: boolean;
  /** Swap which swipe direction is + and which is -. */
  invertScroll: boolean;
  /** Show the gesture hint line on the glasses. */
  showHints: boolean;
}

export type Screen = 'life' | 'mana';

export type LifeField =
  | { kind: 'life' }
  | { kind: 'cmd'; index: number }
  | { kind: 'poison' }
  | { kind: 'tax' };

export interface Persisted {
  v: 1;
  game: Game;
  settings: Settings;
}

const emptyMana = (): Record<Color, number> => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });

export function newGame(startingLife = 40, opponentNames?: string[]): Game {
  const names = opponentNames ?? ['Opp 1', 'Opp 2', 'Opp 3'];
  return {
    startingLife,
    life: startingLife,
    poison: 0,
    casts: 0,
    opponents: names.map((name) => ({ name, cmdDmg: 0 })),
    mana: emptyMana(),
  };
}

export const defaultSettings = (): Settings => ({
  cmdDmgAffectsLife: true,
  invertScroll: false,
  showHints: true,
});

const clone = (g: Game): Game => ({
  ...g,
  opponents: g.opponents.map((o) => ({ ...o })),
  mana: { ...g.mana },
});

export function lifeFields(g: Game): LifeField[] {
  return [
    { kind: 'life' },
    ...g.opponents.map((_, index) => ({ kind: 'cmd' as const, index })),
    { kind: 'poison' },
    { kind: 'tax' },
  ];
}

export const manaTotal = (g: Game) => COLORS.reduce((s, c) => s + g.mana[c], 0);

/** Reasons you've lost, if any. */
export function lethalReasons(g: Game): string[] {
  const out: string[] = [];
  if (g.life <= 0) out.push('life');
  if (g.poison >= POISON_LETHAL) out.push('poison');
  for (const o of g.opponents) if (o.cmdDmg >= CMD_LETHAL) out.push(`${o.name} cmdr`);
  return out;
}

const UNDO_LIMIT = 200;
/** Repeated changes to the same thing within this window undo as one step. */
const GROUP_MS = 2500;
/** How long the "(+3)" recent-change badge stays visible. */
export const DELTA_MS = 3000;

type Listener = () => void;

export class Store {
  game: Game;
  settings: Settings;
  screen: Screen = 'life';
  lifeSel = 0;
  manaSel = 0;
  /** Sum of life changes in the current burst, shown as "(+3)". */
  recentDelta = 0;
  recentAt = 0;

  private history: Game[] = [];
  private lastGroup = '';
  private lastGroupAt = 0;
  private listeners = new Set<Listener>();
  private now: () => number;

  constructor(saved?: Partial<Persisted> | null, now: () => number = Date.now) {
    this.now = now;
    this.game = saved?.game ? sanitizeGame(saved.game) : newGame();
    this.settings = { ...defaultSettings(), ...(saved?.settings ?? {}) };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  toJSON(): Persisted {
    return { v: 1, game: this.game, settings: this.settings };
  }

  get canUndo() {
    return this.history.length > 0;
  }

  // ---- internal mutation helper -------------------------------------------

  private commit(group: string, mutate: (g: Game) => void) {
    const t = this.now();
    const before = clone(this.game);
    if (!(group && group === this.lastGroup && t - this.lastGroupAt < GROUP_MS)) {
      this.history.push(before);
      if (this.history.length > UNDO_LIMIT) this.history.shift();
    }
    this.lastGroup = group;
    this.lastGroupAt = t;
    mutate(this.game);
    const lifeChange = this.game.life - before.life;
    if (lifeChange !== 0) {
      if (t - this.recentAt > DELTA_MS) this.recentDelta = 0;
      this.recentDelta += lifeChange;
      this.recentAt = t;
    }
    this.emit();
  }

  /** The recent-change badge value, or 0 once it has expired. */
  visibleDelta(): number {
    return this.now() - this.recentAt <= DELTA_MS ? this.recentDelta : 0;
  }

  // ---- game actions ---------------------------------------------------------

  adjustLife(n: number) {
    this.commit('life', (g) => {
      g.life += n;
    });
  }

  adjustCmd(index: number, n: number) {
    const opp = this.game.opponents[index];
    if (!opp) return;
    const applied = Math.max(0, opp.cmdDmg + n) - opp.cmdDmg;
    if (applied === 0) return;
    this.commit(`cmd${index}`, (g) => {
      g.opponents[index].cmdDmg += applied;
      if (this.settings.cmdDmgAffectsLife) g.life -= applied;
    });
  }

  adjustPoison(n: number) {
    if (this.game.poison + n < 0) return;
    this.commit('poison', (g) => {
      g.poison += n;
    });
  }

  adjustCasts(n: number) {
    if (this.game.casts + n < 0) return;
    this.commit('casts', (g) => {
      g.casts += n;
    });
  }

  addMana(c: Color, n: number) {
    if (this.game.mana[c] + n < 0) return;
    this.commit(`mana${c}`, (g) => {
      g.mana[c] += n;
    });
  }

  clearMana() {
    if (manaTotal(this.game) === 0) return;
    this.commit('', (g) => {
      g.mana = emptyMana();
    });
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return;
    const lifeChange = prev.life - this.game.life;
    this.game = prev;
    this.lastGroup = '';
    if (lifeChange !== 0 && this.now() - this.recentAt <= DELTA_MS) this.recentDelta += lifeChange;
    this.clampSelection();
    this.emit();
  }

  resetGame() {
    this.commit('', (g) => {
      const fresh = newGame(g.startingLife, g.opponents.map((o) => o.name));
      Object.assign(g, fresh);
    });
    this.recentDelta = 0;
    this.lifeSel = 0;
    this.manaSel = 0;
    this.emit();
  }

  setStartingLife(n: number) {
    this.game.startingLife = n;
    this.emit();
  }

  setOpponentCount(n: number) {
    const count = Math.max(1, Math.min(MAX_OPPONENTS, n));
    this.commit('', (g) => {
      while (g.opponents.length < count) g.opponents.push({ name: `Opp ${g.opponents.length + 1}`, cmdDmg: 0 });
      g.opponents.length = count;
    });
    this.clampSelection();
    this.emit();
  }

  renameOpponent(index: number, name: string) {
    const o = this.game.opponents[index];
    if (!o) return;
    o.name = name.trim().slice(0, 16) || `Opp ${index + 1}`;
    this.emit();
  }

  updateSettings(patch: Partial<Settings>) {
    Object.assign(this.settings, patch);
    this.emit();
  }

  // ---- glasses navigation ---------------------------------------------------

  setScreen(s: Screen) {
    this.screen = s;
    this.emit();
  }

  toggleScreen() {
    this.setScreen(this.screen === 'life' ? 'mana' : 'life');
  }

  /** Move the selection cursor on the current screen. */
  nextField() {
    if (this.screen === 'life') this.lifeSel = (this.lifeSel + 1) % lifeFields(this.game).length;
    else this.manaSel = (this.manaSel + 1) % COLORS.length;
    this.emit();
  }

  selectLifeField(i: number) {
    this.lifeSel = i;
    this.emit();
  }

  /** Apply +n / -n to whatever is selected on the current screen. */
  adjustSelected(n: number) {
    if (this.screen === 'mana') return this.addMana(COLORS[this.manaSel], n);
    const f = lifeFields(this.game)[this.lifeSel];
    switch (f.kind) {
      case 'life':
        return this.adjustLife(n);
      case 'cmd':
        return this.adjustCmd(f.index, n);
      case 'poison':
        return this.adjustPoison(n);
      case 'tax':
        return this.adjustCasts(n);
    }
  }

  private clampSelection() {
    const n = lifeFields(this.game).length;
    if (this.lifeSel >= n) this.lifeSel = 0;
  }
}

function sanitizeGame(raw: Partial<Game>): Game {
  const base = newGame();
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const mana = emptyMana();
  for (const c of COLORS) mana[c] = Math.max(0, num(raw.mana?.[c], 0));
  const opponents = Array.isArray(raw.opponents)
    ? raw.opponents.slice(0, MAX_OPPONENTS).map((o, i) => ({
        name: typeof o?.name === 'string' && o.name ? o.name : `Opp ${i + 1}`,
        cmdDmg: Math.max(0, num(o?.cmdDmg, 0)),
      }))
    : base.opponents;
  return {
    startingLife: num(raw.startingLife, 40),
    life: num(raw.life, num(raw.startingLife, 40)),
    poison: Math.max(0, num(raw.poison, 0)),
    casts: Math.max(0, num(raw.casts, 0)),
    opponents: opponents.length ? opponents : base.opponents,
    mana,
  };
}
