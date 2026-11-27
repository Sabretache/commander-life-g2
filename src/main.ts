import './style.css';
import { COLORS, COLOR_NAMES, CMD_LETHAL, MAX_OPPONENTS, POISON_LETHAL, Store, lethalReasons, manaTotal, type Persisted } from './state';
import { renderScreen } from './render';
import { GlassesView, connectBridge, handleGesture, type Gesture } from './glasses';
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';

const STORAGE_KEY = 'mtg-g2-state';

// ---- persistence -------------------------------------------------------------

async function load(bridge: EvenAppBridge | null): Promise<Partial<Persisted> | null> {
  try {
    const raw = bridge ? await bridge.getLocalStorage(STORAGE_KEY) : localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function makeSaver(bridge: EvenAppBridge | null, store: Store) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const json = JSON.stringify(store.toJSON());
      try {
        if (bridge) void bridge.setLocalStorage(STORAGE_KEY, json);
        else localStorage.setItem(STORAGE_KEY, json);
      } catch {
        /* storage unavailable: state just won't survive a restart */
      }
    }, 400);
  };
}

// ---- tiny DOM helpers ----------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---- views -------------------------------------------------------------------

type Tab = 'life' | 'mana' | 'setup';
let tab: Tab = 'life';

function renderLifeTab(s: Store) {
  const g = s.game;
  const dead = lethalReasons(g);
  const delta = s.visibleDelta();
  const step = (action: string, n: number, label = n > 0 ? `+${n}` : `${n}`) =>
    `<button class="step" data-act="${action}" data-n="${n}">${label}</button>`;

  const cmdRows = g.opponents
    .map((o, i) => {
      const pct = Math.min(100, (o.cmdDmg / CMD_LETHAL) * 100);
      const cls = o.cmdDmg >= CMD_LETHAL ? 'dead' : o.cmdDmg >= CMD_LETHAL - 5 ? 'warn' : '';
      return `<div class="row ${cls}">
        <div class="row-label"><span>${esc(o.name)}</span><small>commander damage</small>
          <div class="bar"><i style="width:${pct}%"></i></div></div>
        ${step(`cmd:${i}`, -1)}<output>${o.cmdDmg}<small>/${CMD_LETHAL}</small></output>${step(`cmd:${i}`, 1)}
      </div>`;
    })
    .join('');

  return `
    <section class="life-card ${dead.length ? 'dead' : ''}">
      <div class="life-num">${g.life}</div>
      <div class="life-delta">${delta ? (delta > 0 ? `+${delta}` : delta) : '&nbsp;'}</div>
      ${dead.length ? `<div class="lethal">Lethal: ${esc(dead.join(', '))}</div>` : ''}
      <div class="life-steps">${step('life', -5)}${step('life', -1)}${step('life', 1)}${step('life', 5)}</div>
    </section>
    <section class="rows">
      ${cmdRows}
      <div class="row ${g.poison >= POISON_LETHAL ? 'dead' : ''}">
        <div class="row-label"><span>Poison</span><small>${POISON_LETHAL} is lethal</small></div>
        ${step('poison', -1)}<output>${g.poison}</output>${step('poison', 1)}
      </div>
      <div class="row">
        <div class="row-label"><span>Commander tax</span><small>cast ${g.casts}× from command zone</small></div>
        ${step('casts', -1)}<output>+${g.casts * 2}</output>${step('casts', 1)}
      </div>
    </section>
    <div class="actions">
      <button data-act="undo" ${s.canUndo ? '' : 'disabled'}>Undo</button>
      <button data-act="reset" class="danger">New game</button>
    </div>`;
}

function renderManaTab(s: Store) {
  const g = s.game;
  const tiles = COLORS.map(
    (c) => `<div class="mana-tile mana-${c}">
      <button class="mana-add" data-act="mana:${c}" data-n="1" aria-label="Add ${COLOR_NAMES[c]}">
        <span class="pip">${c}</span><span class="count">${g.mana[c]}</span><small>${COLOR_NAMES[c]}</small>
      </button>
      <button class="mana-sub" data-act="mana:${c}" data-n="-1" ${g.mana[c] ? '' : 'disabled'} aria-label="Spend ${COLOR_NAMES[c]}">−</button>
    </div>`,
  ).join('');
  return `
    <p class="hint">Tap a colour to add one. Tap − to spend it.</p>
    <div class="mana-total">Floating: <b>${manaTotal(g)}</b></div>
    <section class="mana-grid">${tiles}</section>
    <div class="actions">
      <button data-act="undo" ${s.canUndo ? '' : 'disabled'}>Undo</button>
      <button data-act="clear-mana" class="danger" ${manaTotal(g) ? '' : 'disabled'}>Empty pool</button>
    </div>`;
}

function renderSetupTab(s: Store) {
  const g = s.game;
  const lifeOpts = [20, 25, 30, 40]
    .map((n) => `<button class="chip ${g.startingLife === n ? 'on' : ''}" data-act="start" data-n="${n}">${n}</button>`)
    .join('');
  const countOpts = Array.from({ length: MAX_OPPONENTS }, (_, i) => i + 1)
    .map((n) => `<button class="chip ${g.opponents.length === n ? 'on' : ''}" data-act="opps" data-n="${n}">${n}</button>`)
    .join('');
  const names = g.opponents
    .map((o, i) => `<input class="name" data-i="${i}" value="${esc(o.name)}" maxlength="16" placeholder="Opponent ${i + 1}">`)
    .join('');
  const toggle = (key: keyof Store['settings'], label: string, sub: string) =>
    `<label class="toggle"><span>${label}<small>${sub}</small></span>
      <input type="checkbox" data-setting="${key}" ${s.settings[key] ? 'checked' : ''}></label>`;

  return `
    <h3>Starting life</h3><div class="chips">${lifeOpts}</div>
    <p class="hint">Applies on the next “New game”.</p>
    <h3>Opponents</h3><div class="chips">${countOpts}</div>
    <div class="names">${names}</div>
    <h3>Options</h3>
    ${toggle('cmdDmgAffectsLife', 'Commander damage lowers life', 'Adding commander damage also subtracts it from your life')}
    ${toggle('invertScroll', 'Invert swipe direction', 'Swap which swipe adds and which subtracts')}
    ${toggle('showHints', 'Show gesture hints on glasses', 'Bottom line reminding you of the controls')}
    <h3>Glasses controls</h3>
    <ul class="help">
      <li><b>Swipe</b> forward/back: +1 / −1 to the selected row</li>
      <li><b>Tap</b>: select the next row</li>
      <li><b>Double tap</b>: switch Life ⇄ Mana</li>
      <li><b>Press &amp; hold</b>: undo (Life) · empty pool (Mana)</li>
    </ul>`;
}

// ---- app ---------------------------------------------------------------------

async function main() {
  const status = $('#status');
  const setStatus = (msg: string) => (status.textContent = msg);

  const bridge = await connectBridge();
  const store = new Store(await load(bridge));
  const save = makeSaver(bridge, store);

  const preview = $('#preview');
  const view = $('#view');

  const draw = () => {
    preview.textContent = renderScreen(store);
    $('#preview-screen').textContent = store.screen === 'life' ? 'Life' : 'Mana';
    // The setup tab holds text inputs; only redraw it on explicit navigation so typing isn't interrupted.
    if (tab !== 'setup') view.innerHTML = tab === 'life' ? renderLifeTab(store) : renderManaTab(store);
    document.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  };
  const showTab = (t: Tab) => {
    tab = t;
    if (t === 'setup') view.innerHTML = renderSetupTab(store);
    if (t === 'life' || t === 'mana') store.setScreen(t); // keep glasses in sync with the phone
    draw();
  };

  store.subscribe(draw);
  store.subscribe(save);
  // Let the "(+3)" badge fade on the phone too.
  setInterval(() => store.visibleDelta() === 0 && $('.life-delta')?.innerHTML !== '&nbsp;' && draw(), 500);

  // Phone buttons
  view.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act!;
    const n = Number(btn.dataset.n ?? 0);
    if (act === 'life') store.adjustLife(n);
    else if (act.startsWith('cmd:')) store.adjustCmd(Number(act.slice(4)), n);
    else if (act === 'poison') store.adjustPoison(n);
    else if (act === 'casts') store.adjustCasts(n);
    else if (act.startsWith('mana:')) store.addMana(act.slice(5) as (typeof COLORS)[number], n);
    else if (act === 'clear-mana') store.clearMana();
    else if (act === 'undo') store.undo();
    else if (act === 'reset') {
      if (confirm(`Start a new game at ${store.game.startingLife} life?`)) store.resetGame();
    } else if (act === 'start') {
      store.setStartingLife(n);
      view.innerHTML = renderSetupTab(store);
    } else if (act === 'opps') {
      store.setOpponentCount(n);
      view.innerHTML = renderSetupTab(store);
    }
  });
  view.addEventListener('change', (ev) => {
    const el = ev.target as HTMLInputElement;
    if (el.classList.contains('name')) store.renameOpponent(Number(el.dataset.i), el.value);
    if (el.dataset.setting) store.updateSettings({ [el.dataset.setting]: el.checked });
  });
  document.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) =>
    b.addEventListener('click', () => showTab(b.dataset.tab as Tab)),
  );

  // Glasses preview gesture buttons + keyboard (for testing without glasses)
  const gesture = (g: Gesture) => {
    handleGesture(store, g);
    if (tab !== 'setup' && store.screen !== tab) {
      tab = store.screen;
      draw();
    }
  };
  document.querySelectorAll<HTMLButtonElement>('[data-gesture]').forEach((b) =>
    b.addEventListener('click', () => gesture(b.dataset.gesture as Gesture)),
  );
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const map: Record<string, Gesture> = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'tap', ' ': 'tap', d: 'double', h: 'hold' };
    const g = map[e.key];
    if (g) {
      e.preventDefault();
      gesture(g);
    }
  });

  // Keep the phone tab following the glasses when you double-tap on the glasses.
  store.subscribe(() => {
    if (tab !== 'setup' && store.screen !== tab) {
      tab = store.screen;
      draw();
    }
  });

  showTab('life');

  if (bridge) {
    setStatus('Opening glasses page…');
    await new GlassesView(bridge, store, setStatus).start();
  } else {
    setStatus('Not in the Even App: glasses preview only (keys: ↑ ↓ Enter, D, H)');
  }
}

void main();
