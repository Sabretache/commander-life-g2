// Connects the Store to the G2 glasses through the Even Hub SDK bridge.

import {
  EvenAppBridge,
  OsEventTypeList,
  StartUpPageCreateResult,
  waitForEvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import { Store } from './state';
import { renderScreen } from './render';

const CONTAINER_ID = 1;
const CONTAINER_NAME = 'mtg-main';

export type Gesture = 'up' | 'down' | 'tap' | 'double' | 'hold';

/** Map a gesture to a store action. Shared by the glasses and the phone preview. */
export function handleGesture(store: Store, gesture: Gesture) {
  const sign = store.settings.invertScroll ? -1 : 1;
  switch (gesture) {
    case 'up':
      return store.adjustSelected(+1 * sign);
    case 'down':
      return store.adjustSelected(-1 * sign);
    case 'tap':
      return store.nextField();
    case 'double':
      return store.toggleScreen();
    case 'hold':
      return store.screen === 'life' ? store.undo() : store.clearMana();
  }
}

/** True when running inside the Even App WebView. */
export function inEvenApp(): boolean {
  return typeof (window as any).flutter_inappwebview?.callHandler === 'function';
}

export async function connectBridge(timeoutMs = 4000): Promise<EvenAppBridge | null> {
  if (!inEvenApp()) return null;
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
  return Promise.race([waitForEvenAppBridge(), timeout]);
}

function gestureFromEvent(e: EvenHubEvent): Gesture | null {
  const src = e.textEvent ?? e.sysEvent ?? e.listEvent;
  if (!src) return null;
  // CLICK_EVENT is 0, which protobuf may drop from the payload, so a
  // text/sys event without an eventType is treated as a tap.
  const type = OsEventTypeList.fromJson(src.eventType) ?? OsEventTypeList.CLICK_EVENT;
  switch (type) {
    case OsEventTypeList.CLICK_EVENT:
      return 'tap';
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return 'double';
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return 'up';
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return 'down';
    case OsEventTypeList.LONG_PRESS_EVENT:
      return 'hold';
    default:
      return null;
  }
}

export class GlassesView {
  private sending = false;
  private dirty = false;
  private lastSent = '';
  private deltaTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private bridge: EvenAppBridge,
    private store: Store,
    private onStatus: (msg: string) => void,
  ) {}

  async start() {
    const result = await this.bridge.createStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        {
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          containerID: CONTAINER_ID,
          containerName: CONTAINER_NAME,
          paddingLength: 8,
          content: renderScreen(this.store),
          isEventCapture: 1,
        },
      ],
    } as any);
    if (result !== StartUpPageCreateResult.success) {
      this.onStatus(`Glasses page failed to open (code ${result})`);
      return;
    }
    this.lastSent = renderScreen(this.store);
    this.onStatus('Connected to glasses');

    this.store.subscribe(() => this.schedule());
    this.bridge.onEvenHubEvent((e) => {
      const sys = e.sysEvent?.eventType;
      if (sys === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
        this.lastSent = '';
        return this.schedule();
      }
      const g = gestureFromEvent(e);
      if (g) handleGesture(this.store, g);
    });
  }

  /** Coalesce renders so fast swipes don't queue up stale frames over BLE. */
  private schedule() {
    this.armDeltaTimer();
    if (this.sending) {
      this.dirty = true;
      return;
    }
    void this.flush();
  }

  private async flush() {
    this.sending = true;
    try {
      do {
        this.dirty = false;
        const content = renderScreen(this.store);
        if (content === this.lastSent) continue;
        const ok = await this.bridge.textContainerUpgrade({
          containerID: CONTAINER_ID,
          containerName: CONTAINER_NAME,
          content,
        } as any);
        if (ok) this.lastSent = content;
      } while (this.dirty);
    } catch (err) {
      this.onStatus(`Glasses update failed: ${String(err)}`);
    } finally {
      this.sending = false;
    }
  }

  /** Redraw once the "(+3)" badge expires. */
  private armDeltaTimer() {
    clearTimeout(this.deltaTimer);
    if (!this.store.visibleDelta()) return;
    const wait = Math.max(50, this.store.recentAt + 3000 - Date.now() + 50);
    this.deltaTimer = setTimeout(() => this.schedule(), wait);
  }
}
