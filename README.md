# Northside Golf (Warringah Golf)

A Wii-golf-style game you play in the browser, with your phone as the club. Two real Sydney courses: Warringah (North Manly) and Northbridge.

## Playing

1. Open the site on a computer.
2. Pick a course and a round: 18 holes, front 9, back 9, a quick 3 holes, or a single hole.
3. The first time, a short guide links your phone (QR code), sets your swing, and explains the controls.
4. On the phone: hold the green pad and swing.
   - Aim with ◀ ▶.
   - Tap the ball to add spin.
5. No phone? Play with the keyboard:
   - ← → aim, ↑ ↓ change club.
   - Hold Space and let go to swing.
   - I J K L add spin, X resets it.
   - G reads the green, M switches to the overhead view, S shows the scorecard.

Difficulty:

- **Beginner** (the default for new players): kinder rough, gentle hooks and slices, putts inside about 60 cm are conceded.
- **Standard.**
- **Simulation:** bigger penalties and stronger wind.

## Files

- `index.html`: the game (menu, guide, 3D course, scorecard).
- `controller.html`: the club page that opens on the phone from the QR code.
- `lab.html`: Swing Lab, for fine-tuning your swing detection (optional).
- `js/`: game code.
  - `physics.js`: shots, bounces, rolling, putting, lips, spin, lies, difficulty.
  - `game.js`: game flow, phone link, guide, scoring.
  - `scene.js`: the 3D course.
  - `sound.js`: synthesised sound effects.
  - Plus trees, greens, terrain and golfer.
- `courses/`: generated course data. `*-elev.js` files hold the LiDAR ground heights.
- `tools/`: course builders.
  - Warringah: `build_course.py`.
  - Northbridge: `build_northbridge.py`.
  - Elevation: `build_elev.py <course> [max green slope]`.
  - Trees: `canopy.py`, which traces them from aerial imagery.
- `tests/`: automated tests. See [TESTING.md](TESTING.md).

## Deploying

It is a static site, so GitHub Pages serves it as is. There is no build step. Upload the files and hard-refresh.

## Credits

- Course map data © OpenStreetMap contributors (ODbL).
- Elevation © Geoscience Australia (CC BY 4.0).
- Tree positions and the Northbridge harbour traced from Esri World Imagery.
- Uses three.js, PeerJS and qrcode-generator (vendored).
