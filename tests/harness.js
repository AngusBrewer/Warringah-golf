// Loads the game's pure modules (no 3D) into Node so physics and scoring can be tested.
global.window = global;
const fs = require('fs'), path = require('path');
for (const f of ['js/course.js', 'js/trees.js', 'js/greens.js', 'js/terrain.js', 'js/physics.js']) {
  try { eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')); } catch (e) { if (!/THREE/.test(e.message)) throw e; }
}
// A simple test course: a lie function and an optional tilted plane for the ground.
function flatCourse({lie = () => 'fairway', slope = [0, 0], trees = []} = {}){
  const terrain = {height: (x, y) => x * slope[0] + y * slope[1], grad: () => slope};
  return {lie, terrain, treesNear: () => trees};
}
let failures = 0, passes = 0;
function check(name, ok, info = ''){ if (ok){ passes++; console.log('  ok  ', name, info); } else { failures++; console.log('  FAIL', name, info); } }
function done(){ console.log(`\n${passes} passed, ${failures} failed`); process.exit(failures ? 1 : 0); }
module.exports = {GolfPhysics: global.GolfPhysics, GolfGeo: global.GolfGeo, flatCourse, check, done};
