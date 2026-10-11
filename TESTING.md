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
- Putting: holing firm putts, short putts staying out, lip-ins and lip-outs, the putter range.
- Water, bunkers and trees.

**A whole round in a headless browser.** This needs Playwright and a local web server:

```
python3 -m http.server 8765          # in this folder
COURSE=warringah ROUND=all node tests/e2e-round.js
COURSE=northbridge ROUND=front node tests/e2e-round.js
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
| 5 | Guide step "Set your swing": make 3 full swings holding the pad. | The three dots fill and it moves on by itself. |
| 6 | Make a swing on the tee. | The phone thwacks and the pad flashes; Android also buzzes. The golfer swings and the ball flies. |
| 7 | Hit a ball into the rough, then look at the swing bar. | The white line on the bar drops (yellow), and the panel shows e.g. "Rough 75–85%". |
| 8 | Tap the top of the ball on the phone (or screen), then hit an iron. | The label says Topspin; the ball runs on further after landing. Repeat with backspin: it stops quicker. |
| 9 | Swing much harder than your full swing. | The bar shakes and the shot hooks or slices hard. |
| 10 | On the green, press **Read**. | The slope grid shows; the camera does **not** jump overhead. Pressing Read off the green just shows a message. |
| 11 | Putt short, then long. | Putts roll smoothly; a ball reaching the cup at a good pace drops in without stopping first. Edge putts sometimes lip in or out. |
| 12 | Lock the phone for 10 seconds, then unlock it. | The phone reconnects by itself. If not, use **Phone code → Make a new code** and rescan. |
| 13 | Menu → choose **Front 9**, **Back 9**, **Quick 3 holes** or a single hole, then **Play**. | The round plays only those holes, and the scorecard shows just them. |
| 14 | Menu while mid-round, then **Resume**. | You go back to the same hole with your scores. |
| 15 | No phone: in the pairing window, press **Play with keyboard**. | Arrow keys aim and change club; holding Space and letting go swings. |
| 16 | Change Difficulty to Simulation, then Beginner. | Beginner forgives more: smaller hooks, kinder rough, gimme putts inside about 60 cm. |

## Not covered by the automated tests

- Real phone motion: swing detection, power and face angle.
- iPhone permission prompts.
- Haptics.
- Sound on a real device.

These need the manual tests above.
