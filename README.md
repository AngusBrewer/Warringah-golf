# Northside Golf (Warringah Golf)

A Wii-golf-style game you play in the browser, with your phone as the club. Two real Sydney courses: Warringah (North Manly) and Northbridge.

## Playing

1. Open the site on a computer.
2. Pick a course and a round: 18 holes, front 9, back 9, a quick 3 holes, or a single hole.
3. The first time, a short guide links your phone (QR code), sets your swing, and explains the controls.
4. On the phone: hold it like a club grip with the screen facing the target (the screen is the clubface) and the volume buttons pointing down. Tap the green pad, hold still at address until it clicks, then swing.
   - Aim with ◀ ▶: a tap nudges it, holding turns it (slowly at first).
   - Tap the ball to add spin.
5. No phone? Play with the keyboard:
   - ← → aim, ↑ ↓ change club.
   - Hold Space and let go to swing.
   - I J K L add spin, X resets it.
   - G reads the green, M switches to the overhead view, S shows the scorecard.

Two players: choose **2 players** in the menu, then each player scans the QR code with their own phone (the first phone is Player 1). Each phone only swings on its owner's turn. Whoever is farthest from the hole plays next, and the lowest score on the last hole tees off first. The other player's ball shows as a coloured ball on a pole, and the scorecard has a row for each player.

There is one difficulty setting for everyone. Putts inside about 60 cm are conceded.

Out of bounds (stroke and distance) is anywhere off the property, or a ball that finishes more than 30 m (par 3s) or 40 m (longer holes) from the line of the hole you're playing (45 m around the green), unless it's on or right by a fairway, green or tee.

## Files

- `index.html`: the game (menu, guide, 3D course, scorecard).
- `controller.html`: the club page that opens on the phone from the QR code.
- `lab.html`: Swing Lab, for fine-tuning your swing detection (optional).
- `js/`: game code.
  - `physics.js`: shots, bounces, rolling, putting, the cup, spin, lies.
  - `game.js`: game flow, phone link, guide, scoring.
  - `scene.js`: the 3D course.
  - `sound.js`: synthesised sound effects.
  - Plus trees, greens, terrain and golfer.
- `courses/`: generated course data. `*-elev.js` files hold the LiDAR ground heights; `northbridge-photo.jpg` is the aerial photo laid on Northbridge's ground.
- `tools/`: course builders.
  - Warringah: `build_course.py`.
  - Northbridge: `build_northbridge.py`.
  - Elevation: `build_elev.py <course> [max green slope]` (5 m data), or `build_elev1m.py <course> <tiles.tif…>` for NSW 1 m LiDAR tiles downloaded from Elvis (elevation.fsdf.org.au).
  - Ground photo: `build_photo.py <course> <photo> x0 y0 x1 y1` (NSW aerial imagery resampled to course metres at 3 px/m).
  - Trees: `canopy.py`, which traces them from aerial imagery.
- `tests/`: automated tests. See [TESTING.md](TESTING.md).

## Deploying

It is a static site, so GitHub Pages serves it as is. There is no build step. Upload the files and hard-refresh.

## Credits

- Course map data © OpenStreetMap contributors (ODbL).
- Elevation © Geoscience Australia (CC BY 4.0); Northbridge 1 m LiDAR and aerial photo © Spatial Services NSW (CC BY 4.0).
- Tree positions and the Northbridge harbour traced from Esri World Imagery.
- Uses three.js, PeerJS and qrcode-generator (vendored).
