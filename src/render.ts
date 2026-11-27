// Builds the plain-text frames shown on the G2 display (576x288, one text container).
// ASCII only: the glasses font is not guaranteed to have symbol glyphs.

import {
  CMD_LETHAL,
  COLORS,
  COLOR_NAMES,
  POISON_LETHAL,
  Store,
  lethalReasons,
  lifeFields,
  manaTotal,
} from './state';

/** Field rows visible at once; the list scrolls to keep the cursor in view. */
export const MAX_ROWS = 6;

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function windowRows<T>(rows: T[], sel: number, max = MAX_ROWS): { rows: T[]; offset: number } {
  if (rows.length <= max) return { rows, offset: 0 };
  const offset = Math.min(Math.max(0, sel - Math.floor(max / 2)), rows.length - max);
  return { rows: rows.slice(offset, offset + max), offset };
}

export function renderLife(s: Store): string {
  const g = s.game;
  const delta = s.visibleDelta();
  const dead = lethalReasons(g);

  let header = `LIFE ${g.life}`;
  if (delta) header += `   (${signed(delta)})`;
  if (dead.length) header += `   !! LETHAL: ${dead.join(', ')}`;
  else if (manaTotal(g)) header += `   | mana ${manaTotal(g)}`;

  const all = lifeFields(g).map((f) => {
    switch (f.kind) {
      case 'life':
        return `Life  ${g.life}`;
      case 'cmd': {
        const o = g.opponents[f.index];
        const warn = o.cmdDmg >= CMD_LETHAL ? '  DEAD' : o.cmdDmg >= CMD_LETHAL - 5 ? '  !' : '';
        return `Cmdr ${o.name}  ${o.cmdDmg}/${CMD_LETHAL}${warn}`;
      }
      case 'poison': {
        const warn = g.poison >= POISON_LETHAL ? '  DEAD' : '';
        return `Poison  ${g.poison}/${POISON_LETHAL}${warn}`;
      }
      case 'tax':
        return `Cmdr tax  +${g.casts * 2}   (cast ${g.casts}x)`;
    }
  });

  const { rows, offset } = windowRows(all, s.lifeSel);
  const body = rows.map((r, i) => (i + offset === s.lifeSel ? `> ${r}` : `   ${r}`));
  const lines = [header, ...body];
  if (s.settings.showHints) lines.push('swipe +/-   tap: next   2x: mana   hold: undo');
  return lines.join('\n');
}

export function renderMana(s: Store): string {
  const g = s.game;
  const total = manaTotal(g);
  const pool = COLORS.filter((c) => g.mana[c] > 0)
    .map((c) => c.repeat(Math.min(g.mana[c], 6)) + (g.mana[c] > 6 ? `x${g.mana[c]}` : ''))
    .join(' ');

  const header = `MANA POOL  ${total}${pool ? `   ${pool}` : '   (empty)'}`;
  const body = COLORS.map((c, i) => {
    const row = `${c}  ${COLOR_NAMES[c]}  ${g.mana[c]}`;
    return i === s.manaSel ? `> ${row}` : `   ${row}`;
  });
  const lines = [header, ...body];
  if (s.settings.showHints) lines.push('swipe +/-   tap: next   2x: life   hold: empty');
  return lines.join('\n');
}

export const renderScreen = (s: Store) => (s.screen === 'life' ? renderLife(s) : renderMana(s));
