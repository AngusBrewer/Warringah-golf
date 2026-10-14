// Run with: node tests/physics.test.js
// Simulates shots, roll-out, putts and lies on simple test courses and checks the results make sense.
const {GolfPhysics: P, flatCourse, check, done} = require('./harness.js');
const avg = (n, f) => { let s = 0; for (let i = 0; i < n; i++) s += f(); return s / n; };
const shot = (c, o) => P.fullShot(c, Object.assign({from: [0, 0], ang: 0, power: 1, lie: 'fairway'}, o));

console.log('Full shots on a flat fairway');
const flat = flatCourse();
for (const club of ['Dr', '3W', '5i', '7i', '9i', 'PW', 'SW']){
  const C = P.CLUBS[club], r = shot(flat, {club});
  check(`${club} carries its full distance`, Math.abs(r.carry - C.max) < 1, `${r.carry.toFixed(1)} m`);
  const run = avg(10, () => { const q = shot(flat, {club}); return q.total - q.carry; });
  check(`${club} runs out a sensible amount`, run > C.max * C.roll * 0.4 && run < C.max * C.roll * 2.5 + 4, `${run.toFixed(1)} m`);
}
check('half power goes about half as far', (() => { const r = shot(flat, {club: '7i', power: 0.5}); return r.carry > 70 && r.carry < 85; })());
const b = shot(flat, {club: 'Dr'});
check('the ball bounces after landing', b.rollTrack.some(p => p[2] > 0.2), `first bounce ${Math.max(...b.rollTrack.map(p => p[2])).toFixed(2)} m`);

console.log('Lies (Wii style: woods suffer most)');
const lf = (lie, club) => P.lieFactor(lie, club);
check('the rough costs a driver more than a wedge', lf('rough', 'Dr') < lf('rough', '7i') && lf('rough', '7i') < lf('rough', 'SW'), ['Dr', '7i', 'SW'].map(c => Math.round(lf('rough', c) * 100) + '%').join(' '));
check('a bunker costs a driver far more than a sand wedge', lf('bunker', 'Dr') < 0.75 && lf('bunker', 'SW') > 0.85, ['Dr', 'SW'].map(c => Math.round(lf('bunker', c) * 100) + '%').join(' '));
check('the fairway costs nothing', lf('fairway', 'Dr') === 1);
check('a rough lie shortens the shot', shot(flat, {club: '7i', lie: 'rough'}).carry < 135);

console.log('Spin');
const top = avg(8, () => shot(flat, {club: '7i', spin: {top: 1, side: 0}}).total), back = avg(8, () => shot(flat, {club: '7i', spin: {top: -1, side: 0}}).total), none = avg(8, () => shot(flat, {club: '7i'}).total);
check('topspin runs further than no spin', top > none, `${top.toFixed(1)} vs ${none.toFixed(1)}`);
check('backspin stops it shorter', back < none, `${back.toFixed(1)} vs ${none.toFixed(1)}`);
const fade = shot(flat, {club: '7i', spin: {top: 0, side: 1}});
check('side spin curves it right', fade.rest[1] < -5, `${fade.rest[1].toFixed(1)} m`);
const green = flatCourse({lie: () => 'green'});
const check1 = shot(green, {club: 'PW', power: 0.8, spin: {top: -1, side: 0}});
check('big backspin can check back on a green', check1.total < check1.carry + 0.5, `carry ${check1.carry.toFixed(1)}, total ${check1.total.toFixed(1)}`);

console.log('Run-out, bounces and backspin (version 15)');
const onGreen = flatCourse({lie: () => 'green'});
const g7 = avg(10, () => { const r = shot(onGreen, {club: '7i'}); return r.total - r.carry; });
check('a full 7 iron landing on a green runs a few metres, not 20', g7 > 1.5 && g7 < 6, `${g7.toFixed(1)} m`);
const t7 = avg(10, () => shot(onGreen, {club: '7i'}).rollTrack.at(-1)[3]);
check('...and stops within about 3 seconds', t7 < 3.5, `${t7.toFixed(1)} s`);
const chip = avg(10, () => { const r = shot(onGreen, {club: 'SW', power: 0.3}); return r.total - r.carry; });
check('a chip still rolls out a little on the green', chip > 0.8 && chip < 4, `${chip.toFixed(1)} m`);
const hop = avg(10, () => Math.max(...shot(flat, {club: 'Dr'}).rollTrack.map(p => p[2])));
check('a drive bounces visibly on the fairway', hop > 1, `${hop.toFixed(1)} m high`);
const zipSW = avg(10, () => { const r = shot(onGreen, {club: 'SW', spin: {top: -1, side: 0}}); return r.total - r.carry; });
check('a full sand wedge with backspin zips back on the green', zipSW < -1, `${zipSW.toFixed(1)} m`);
const zip7 = avg(10, () => { const r = shot(onGreen, {club: '7i', spin: {top: -1, side: 0}}); return r.total - r.carry; });
check('...more than a 7 iron does', zipSW < zip7, `7 iron ${zip7.toFixed(1)} m`);

console.log('Rolling on slopes');
const hillRough = flatCourse({lie: () => 'rough', slope: [-0.25, 0]});   // falling away 25%
const flatRough = flatCourse({lie: () => 'rough'});
const down = avg(6, () => { const r = shot(hillRough, {club: '7i', power: 0.6}); return r.total - r.carry; });
const lvl = avg(6, () => { const r = shot(flatRough, {club: '7i', power: 0.6}); return r.total - r.carry; });
check('the ball keeps rolling down a slope in the rough', down > lvl * 1.5, `${down.toFixed(1)} m vs ${lvl.toFixed(1)} m on the flat`);
const steep = flatCourse({lie: () => 'fairway', slope: [0, -0.45]});
const st = {x: 0, y: 0, vx: 0, vy: 0, t: 0}, tr = []; P.roll(steep, st, {track: tr});
check('a ball resting on a very steep bank starts to roll downhill', st.y > 1, `${st.y.toFixed(1)} m`);
const gentle = flatCourse({lie: () => 'rough', slope: [0, -0.05]});
const st2 = {x: 0, y: 0, vx: 0, vy: 0, t: 0}; P.roll(gentle, st2, {track: []});
check('but stays put on a gentle slope in the rough', Math.hypot(st2.x, st2.y) < 0.05);

console.log('Putting');
const pg = (d, over, off = 0, n = 300) => { let h = 0, lin = 0, lout = 0; for (let i = 0; i < n; i++){ const range = P.puttRange(d), p = P.puttPower(d + over);
  const r = P.putt(green, {from: [0, 0], ang: Math.atan2(off, d), power: p, max: range, pin: [d, 0]}); if (r.holed){ h++; if (r.lipIn) lin++; } else if (r.lip) lout++; } return {h: h / n, lin, lout}; };
check('a firm, straight 3 m putt drops', pg(3, 0.5).h > 0.97);
check('a firm, straight 9 m putt drops', pg(9, 0.6).h > 0.97);
check('a putt that is too short stays out', pg(3, -0.4).h === 0);
check('a putt that is far too fast hops over', pg(3, 9).h === 0);
const mid = P.putt(green, {from: [0, 0], ang: 0, power: P.puttPower(5), max: P.puttRange(5), pin: [50, 0]});
check('the putter is one fixed range: the stroke for 5 m rolls 5 m', Math.abs(mid.rest[0] - 5) < 0.3, `${Math.round(P.puttPower(5) * 100)}% → ${mid.rest[0].toFixed(2)} m`);
check('short putts take less of the bar', P.puttPower(1) < P.puttPower(3) && P.puttPower(3) < 0.4 && P.puttPower(3) > 0.25, `1 m ${Math.round(P.puttPower(1) * 100)}%, 3 m ${Math.round(P.puttPower(3) * 100)}%`);
// the cup is real physics now: send balls at it at set speeds and offsets
const atCup = (v, b, flag = false) => { const mu = P.SURF.green.mu * 9.81, st = {x: -1, y: b * P.CUP, vx: Math.sqrt(v * v + 2 * mu * (1 - Math.sqrt(Math.max(0, 1 - b * b)) * P.CUP)), vy: 0, t: 0};
  const r = P.roll(green, st, {track: [], pin: [0, 0], flag}); return r.holed ? (st.lipIn ? 'lipin' : 'in') : (st.lip || 'miss'); };
check('the cup is 10% bigger than before', Math.abs(P.CUP - 0.132) < 1e-9);
check('dead centre at 1.2 m/s drops', atCup(1.2, 0) === 'in');
check('dead centre at 3 m/s jumps the hole', atCup(3, 0) !== 'in');
check('a firm putt (2.3 m/s) straight at the middle still drops', atCup(2.3, 0) === 'in');
check('half way out at 1.2 m/s still drops', atCup(1.2, 0.5) === 'in');
check('catching the side slowly curls in (lip-in)', ['lipin', 'in'].includes(atCup(0.6, 0.85)), atCup(0.6, 0.85));
check('catching the side with pace spins out (lip-out)', ['out', 'over'].includes(atCup(1.4, 0.85)), atCup(1.4, 0.85));
check('missing the cup by a whisker stays out', atCup(1, 1.05) === 'miss');
check('the flagstick stops a firm, central chip', atCup(3, 0, true) === 'in' && atCup(3, 0, false) !== 'in');
let lin = 0, lout = 0; for (let b = 0.6; b < 1; b += 0.02) for (let v = 0.4; v < 2; v += 0.1){ const r = atCup(v, b); if (r === 'lipin') lin++; if (r === 'out' || r === 'over') lout++; }
check('across the edge of the cup, some lip in and some lip out', lin > 3 && lout > lin, `lip-ins ${lin}, lip-outs ${lout}`);
check('a putt wide of the cup misses', pg(4, 0.3, 0.25).h === 0);
check('the putter range is the same for every putt', P.puttRange(1.5) === P.puttRange(15));
const fullP = P.putt(green, {from: [0, 0], ang: 0, power: 1, pin: [80, 0]});
check('a full stroke rolls the putter range on a flat green', Math.abs(fullP.rest[0] - P.PUTT_MAX) < 0.6, `${fullP.rest[0].toFixed(2)} m`);

console.log('Chip-ins');
const chipGreen = flatCourse({lie: (x) => x > 20 ? 'green' : 'fairway'});
let chips = 0, gentlePast = 0; for (let i = 0; i < 200; i++){ const r = shot(chipGreen, {club: 'SW', power: 0.335 + (i % 20) * 0.0015, pin: [30, 0], spin: {top: 0, side: 0}}); if (r.holed) chips++;
  else if (Math.abs(r.rest[1]) < 0.03 && r.rest[0] > 30 && r.rest[0] < 31.2) gentlePast++; }   // on line, and only ~1 m/s at the hole
check('chips running at the hole can go in', chips > 5, `${chips} of 200 holed`);
check('a chip on line at a gentle pace never rolls over the hole', gentlePast === 0, `${gentlePast} ran past`);

console.log('Wind');
const calm = shot(flat, {club: 'Dr'}), cross = shot(flat, {club: 'Dr', wind: [0, -10]}), head = shot(flat, {club: 'Dr', wind: [-10, 0]});
check('a 10 m/s crosswind blows a drive well off line', Math.abs(cross.land[1] - calm.land[1]) > 20, `${Math.abs(cross.land[1] - calm.land[1]).toFixed(0)} m`);
check('a 10 m/s headwind costs a drive a lot of carry', calm.carry - head.carry > 25, `${(calm.carry - head.carry).toFixed(0)} m`);

console.log('Hazards and trees');
const water = flatCourse({lie: (x) => x > 120 && x < 160 ? 'water' : 'fairway'});
check('a ball landing in water stays there', shot(water, {club: '7i'}).lie === 'water');
const bunker = flatCourse({lie: (x) => x > 140 && x < 170 ? 'bunker' : 'fairway'});
const inB = shot(bunker, {club: '7i'}); check('a ball in a bunker stops dead', inB.lie === 'bunker' && inB.total - inB.carry < 1);
const tree = {x: 128, y: 0, r: 6, h: 20, base: 8, kind: 'gum'};
const leafy = flatCourse({trees: [tree]});
const lr = shot(leafy, {club: '7i'});
check('leaves slow the ball rather than stop it', lr.events.includes('leaves') || lr.events.includes('tree'));
check('a ball never ends up behind where it started', avg(20, () => shot(leafy, {club: '7i'}).rest[0]) > 30);

done();
