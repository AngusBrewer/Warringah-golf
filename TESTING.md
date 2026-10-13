# Testing Northside Golf

## Automated tests (run on a computer)

**Physics and rules** (no browser needed):

```
node tests/physics.test.js
```

It checks:

- Club distances and run-out.
- Bounces.
- Lie ranges: rough and bunker cost more with woods than with wedges.
- Difficulty.
- Spin: topspin runs on, backspin stops and can check back, side spin curves.
- Rolling on slopes.
- Putting and the cup (real rim physics): capture speeds through the middle and off-centre, lip-ins and lip-outs, the flagstick, and the one fixed putter (a full stroke is 22 m; shorter putts take less).
- Run-out, bounces and backspin: a 7 iron onto a green runs a few metres and stops within ~3 s; drives bounce visibly; a sand wedge with backspin zips back.
- Chip-ins: chips on line at a gentle pace drop instead of running over the hole.
- Water, bunkers and trees.

**A whole round in a headless browser.** This needs Playwright and a local web server:

```
python3 -m http.server 8765          # in this folder
COURSE=warringah ROUND=all node tests/e2e-round.js
COURSE=northbridge ROUND=front node tests/e2e-round.js
PLAYERS=2 COURSE=warringah ROUND=quick3 node tests/e2e-round.js   # two players taking turns
```

**The phone's tap-then-swing** with simulated motion (no phone needed):

```
node tests/controller-swing.js
```

`ROUND` can be `all`, `front`, `back`, `quick3`, or a hole number. A bot plays every shot. The test passes if there are no page errors and every hole of the round gets a score.

## Manual tests with a real phone

Use the GitHub Pages address, not a file opened from disk, because phone motion needs https. Before each session, press **Option+Command+R** on the Mac to load the newest version, and check the menu shows the version number you expect.

| # | Do this | You should see |
|---|---|---|
| 1 | First visit in a private window. Click **Play** next to a course. | The welcome guide: safety, then the QR code. |
| 2 | Scan the QR code with the phone camera and open the link. | The phone page shows **Start**. |
| 3 | Tap **Start**. On iPhone, tap **Allow** for motion. | The screen says "Phone linked and sending your swing" and the dot pulses green. |
| 4 | On iPhone, tap **Don't Allow** instead, then reload. | The phone explains how to turn motion back on (aA → Website Settings). |
| 5 | Guide step "Set your swing": for each of 3 full swings, tap the pad, hold still until it clicks, then swing. Hold the phone with the screen facing the target and the volume buttons down. | The three dots fill and it moves on by itself. |
| 6 | Make a swing on the tee: tap, settle, swing. | The pad turns amber ("Hold still…"), clicks and says "Swing!". After the swing the phone thwacks, even with the silent switch on. The golfer swings and the ball flies. Waving the phone around without tapping does nothing. |
| 6d | Slice one deep into the bush, well wide of the hole. | "OB": one-stroke penalty and you play again from where you hit. A ball on a neighbouring fairway is still in play. |
| 6b | Tap the pad, then keep moving the phone. Tap again. | It won't arm while moving; the second tap cancels. |
| 6c | Hold ◀ on the phone for a few seconds; then just tap it. | Holding turns the aim slowly at first, then faster. A tap nudges it a fraction of a degree. |
| 7 | Hit a ball into the rough, then look at the swing bar. | The white line on the bar drops (yellow), and the panel shows e.g. "Rough 75–85%". |
| 8 | Tap the top of the ball on the phone (or screen), then hit an iron. | The label says Topspin; the ball runs on further after landing. Repeat with backspin: it stops quicker. |
| 9 | Swing much harder than your full swing. | The bar shakes and the shot hooks or slices hard. |
| 10 | On the green, press **Read**. | The slope grid shows; the camera does **not** jump overhead. Pressing Read off the green just shows a message. |
| 11 | Putt short, then long. | The flag comes out when you putt. Putts roll smoothly into the cup and drop. Firm putts can hit the back and jump out; balls catching the edge curl in slowly or spin out with pace. |
| 11b | Chip from just off the green straight at the flag. | The flag stays in; a chip running at the hole at a sensible pace hits the stick or drops in rather than rolling over. |
| 12 | Lock the phone for 10 seconds, then unlock it. | The phone reconnects by itself. If not, use **Phone code → Make a new code** and rescan. |
| 13 | Menu → choose **Front 9**, **Back 9**, **Quick 3 holes** or a single hole, then **Play**. | The round plays only those holes, and the scorecard shows just them. |
| 14 | Menu while mid-round, then **Resume**. | You go back to the same hole with your scores. |
| 15 | No phone: in the pairing window, press **Play with keyboard**. | Arrow keys aim and change club; holding Space and letting go swings. |
| 17 | Menu → Players: **2 players**. Play, then scan the code with a second phone. | Each phone says Player 1 / Player 2. The chip shows "P1 ✓ P2 ✓". Only the player whose turn it is can swing; the other phone says to wait. |
| 18 | Finish a hole with two players. | The scorecard shows a row for each player; at the end of the round it names the winner. |

## Not covered by the automated tests

- Real phone motion: swing detection, power and face angle.
- iPhone permission prompts.
- Haptics.
- Sound on a real device.

These need the manual tests above.
