# Commander Life — Even Realities G2

A Magic: The Gathering companion for the G2 glasses. It tracks your Commander life total and your floating mana.

## On the glasses

The app has two screens. Double tap to switch between them.

**Life**
```
LIFE 33   (-7)
> Life  33
   Cmdr Opp 1  2/21
   Cmdr Opp 2  0/21
   Cmdr Opp 3  0/21
   Poison  0/10
   Cmdr tax  +0   (cast 0x)
swipe +/-   tap: next   2x: mana   hold: undo
```

**Mana**
```
MANA POOL  3   U GG
> W  White  0
   U  Blue  1
   ...
swipe +/-   tap: next   2x: life   hold: empty
```

| Gesture (temple or R1 ring) | Life screen | Mana screen |
|---|---|---|
| Swipe forward / back | +1 / −1 to the selected row | add / spend 1 of the selected colour |
| Tap | select the next row | select the next colour |
| Double tap | go to Mana | go to Life |
| Press & hold | undo | empty the pool |

- **Commander damage** also lowers your life by default, because it is still damage. You can turn this off in Setup.
- **Lethal warnings** appear in the header at 0 life, 10 poison, or 21 damage from one commander.
- **`(-7)`** is the total of your recent life changes. It clears 3 seconds after the last change.
- **Undo** groups a run of swipes on the same row, so one hold reverses the whole run.
- Game state is saved through the Even App, so it survives closing the app.

## On the phone

The Even App shows a full touch interface for the same game. It has big ± buttons, commander damage bars, mana tiles, and a Setup tab. In Setup you can set starting life (20/25/30/40), the number of opponents (1–5), opponent names and options. A live preview at the top shows exactly what is on the glasses.

In an ordinary browser, the preview works as a simulator. Use the gesture buttons, or the keys ↑ ↓ (swipe), Enter (tap), D (double tap) and H (hold).

## Run it on your glasses

```bash
npm install
npm run dev                         # serves on your LAN at :5173
npx @evenrealities/evenhub-cli qr --port 5173
```
In the Even App, turn on developer mode and scan the QR code. The app then opens on the phone and the glasses.

To make an installable package:
```bash
npm run build
npx @evenrealities/evenhub-cli pack app.json ./dist -o mtg-g2.ehpk
```
Change `package_id` in `app.json` before you upload with `evenhub create`.

## Code

- `src/state.ts`: game model (life, commander damage, poison, tax, mana, undo). It is pure and unit tested.
- `src/render.ts`: the text frames sent to the 576×288 display.
- `src/glasses.ts`: Even Hub SDK bridge. It creates one full-screen text container, maps input events to gestures and sends redraws one at a time.
- `src/main.ts`: phone UI and saving state.
- `npm test`: 14 tests, including a mock-bridge test of the glasses wiring.
