import { describe, expect, it, vi } from 'vitest';
import { Store, lethalReasons, lifeFields } from './state';
import { MAX_ROWS, renderLife, renderMana } from './render';
import { GlassesView, handleGesture } from './glasses';
import { OsEventTypeList } from '@evenrealities/even_hub_sdk';

const clock = () => {
  let t = 1_000_000;
  const now = () => t;
  return { now, tick: (ms: number) => (t += ms) };
};

describe('life & commander damage', () => {
  it('starts at 40 with three opponents', () => {
    const s = new Store();
    expect(s.game.life).toBe(40);
    expect(s.game.opponents).toHaveLength(3);
  });

  it('commander damage also lowers life by default, and cannot go below zero', () => {
    const s = new Store();
    s.adjustCmd(1, 7);
    expect(s.game.opponents[1].cmdDmg).toBe(7);
    expect(s.game.life).toBe(33);
    s.adjustCmd(1, -10);
    expect(s.game.opponents[1].cmdDmg).toBe(0);
    expect(s.game.life).toBe(40);
  });

  it('can keep commander damage separate from life', () => {
    const s = new Store();
    s.updateSettings({ cmdDmgAffectsLife: false });
    s.adjustCmd(0, 5);
    expect(s.game.life).toBe(40);
  });

  it('flags lethal life, poison and 21 commander damage', () => {
    const s = new Store();
    s.updateSettings({ cmdDmgAffectsLife: false });
    expect(lethalReasons(s.game)).toEqual([]);
    s.adjustCmd(2, 21);
    s.adjustPoison(10);
    s.adjustLife(-40);
    expect(lethalReasons(s.game)).toEqual(['life', 'poison', 'Opp 3 cmdr']);
  });

  it('tracks commander tax as 2 per cast', () => {
    const s = new Store();
    s.adjustCasts(1);
    s.adjustCasts(1);
    expect(renderLife(s)).toContain('Cmdr tax  +4');
  });
});

describe('undo grouping and recent-change badge', () => {
  it('groups a burst of changes to the same field into one undo step', () => {
    const c = clock();
    const s = new Store(null, c.now);
    for (let i = 0; i < 5; i++) {
      s.adjustLife(-1);
      c.tick(300);
    }
    s.adjustPoison(1);
    expect(s.game.life).toBe(35);
    s.undo();
    expect(s.game.poison).toBe(0);
    expect(s.game.life).toBe(35);
    s.undo();
    expect(s.game.life).toBe(40);
    expect(s.canUndo).toBe(false);
  });

  it('starts a new undo step after a pause', () => {
    const c = clock();
    const s = new Store(null, c.now);
    s.adjustLife(-3);
    c.tick(5000);
    s.adjustLife(-2);
    s.undo();
    expect(s.game.life).toBe(37);
  });

  it('shows the accumulated delta, then clears it', () => {
    const c = clock();
    const s = new Store(null, c.now);
    s.adjustLife(-2);
    c.tick(500);
    s.adjustLife(-3);
    expect(s.visibleDelta()).toBe(-5);
    expect(renderLife(s)).toMatch(/^LIFE 35 {3}\(-5\)/);
    c.tick(3500);
    expect(s.visibleDelta()).toBe(0);
    expect(renderLife(s).split('\n')[0]).toBe('LIFE 35');
  });

  it('new game keeps opponent names and starting life', () => {
    const s = new Store();
    s.renameOpponent(0, 'Alice');
    s.setStartingLife(30);
    s.adjustLife(-10);
    s.addMana('G', 3);
    s.resetGame();
    expect(s.game.life).toBe(30);
    expect(s.game.opponents[0]).toEqual({ name: 'Alice', cmdDmg: 0 });
    expect(s.game.mana.G).toBe(0);
    s.undo();
    expect(s.game.life).toBe(30); // undo of reset restores pre-reset state
    expect(s.game.mana.G).toBe(3);
  });
});

describe('mana pool', () => {
  it('adds, spends, never goes negative, and empties', () => {
    const s = new Store();
    s.addMana('U', 2);
    s.addMana('B', 1);
    s.addMana('B', -5);
    expect(s.game.mana.B).toBe(1);
    expect(renderMana(s).split('\n')[0]).toBe('MANA POOL  3   UU B');
    s.clearMana();
    expect(renderMana(s)).toContain('(empty)');
  });
});

describe('glasses gestures', () => {
  it('tap cycles rows, swipe adjusts the selected row, double tap switches screen, hold undoes/empties', () => {
    const s = new Store();
    handleGesture(s, 'down');
    expect(s.game.life).toBe(39);
    handleGesture(s, 'tap'); // -> Cmdr Opp 1
    handleGesture(s, 'up');
    expect(s.game.opponents[0].cmdDmg).toBe(1);
    handleGesture(s, 'hold'); // undo
    expect(s.game.opponents[0].cmdDmg).toBe(0);

    handleGesture(s, 'double');
    expect(s.screen).toBe('mana');
    handleGesture(s, 'tap'); // W -> U
    handleGesture(s, 'up');
    handleGesture(s, 'up');
    expect(s.game.mana.U).toBe(2);
    handleGesture(s, 'hold'); // empty pool
    expect(s.game.mana.U).toBe(0);
  });

  it('respects inverted swipe', () => {
    const s = new Store();
    s.updateSettings({ invertScroll: true });
    handleGesture(s, 'up');
    expect(s.game.life).toBe(39);
  });

  it('keeps the cursor visible with 5 opponents', () => {
    const s = new Store();
    s.setOpponentCount(5);
    const n = lifeFields(s.game).length; // 8 rows
    for (let i = 0; i < n - 1; i++) s.nextField();
    const lines = renderLife(s).split('\n');
    expect(lines.filter((l) => /^( {3}|> )/.test(l))).toHaveLength(MAX_ROWS);
    expect(lines.some((l) => l.startsWith('> Cmdr tax'))).toBe(true);
  });
});

describe('GlassesView with a mock bridge', () => {
  function mockBridge() {
    let handler: (e: any) => void = () => {};
    const sent: string[] = [];
    const bridge = {
      createStartUpPageContainer: vi.fn(async (c: any) => {
        sent.push(c.textObject[0].content);
        return 0;
      }),
      textContainerUpgrade: vi.fn(async (c: any) => {
        sent.push(c.content);
        return true;
      }),
      onEvenHubEvent: (cb: any) => {
        handler = cb;
        return () => {};
      },
    };
    return { bridge, sent, fire: (e: any) => handler(e) };
  }

  it('creates one full-screen event-capturing text container and maps device events', async () => {
    const { bridge, sent, fire } = mockBridge();
    const s = new Store();
    await new GlassesView(bridge as any, s, () => {}).start();

    const page = bridge.createStartUpPageContainer.mock.calls[0][0];
    expect(page.containerTotalNum).toBe(1);
    expect(page.textObject[0]).toMatchObject({ width: 576, height: 288, isEventCapture: 1 });
    expect(sent[0]).toMatch(/^LIFE 40/);

    fire({ textEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } });
    await Promise.resolve();
    expect(s.game.life).toBe(39);

    fire({ sysEvent: {} }); // click with eventType omitted (proto default 0)
    expect(s.lifeSel).toBe(1);

    fire({ sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } });
    expect(s.screen).toBe('mana');

    fire({ sysEvent: { eventType: OsEventTypeList.IMU_DATA_REPORT } }); // ignored
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.at(-1)).toMatch(/^MANA POOL/);
  });
});
