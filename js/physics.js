// Shot and putt simulation. Pure functions of the course, so they can be tested on their own
// (see tests/physics.test.js).
(function(){
'use strict';

const G = 9.81;
const CLUBS = {
  Dr: {name:'Driver',         max:230, apex:28, roll:0.12, curve:1.0,  wind:1.0,  kind:'wood'},
  '3W': {name:'3 wood',       max:210, apex:26, roll:0.10, curve:0.9,  wind:0.95, kind:'wood'},
  '5i': {name:'5 iron',       max:170, apex:24, roll:0.07, curve:0.7,  wind:0.85, kind:'iron'},
  '7i': {name:'7 iron',       max:150, apex:25, roll:0.05, curve:0.6,  wind:0.8,  kind:'iron'},
  '9i': {name:'9 iron',       max:125, apex:27, roll:0.04, curve:0.5,  wind:0.75, kind:'wedge'},
  PW: {name:'Pitching wedge', max:105, apex:28, roll:0.03, curve:0.4,  wind:0.7,  kind:'wedge'},
  SW: {name:'Sand wedge',     max:80,  apex:24, roll:0.02, curve:0.35, wind:0.6,  kind:'wedge'},
  Pt: {name:'Putter',         max:24,  apex:0,  roll:0,    curve:0,    wind:0, putt:true, kind:'putter'}
};
const ORDER = ['Dr','3W','5i','7i','9i','PW','SW','Pt'];
// the cup is drawn bigger than real (like Wii golf), so it catches a little more
const CUP = 0.12;
const BALL_R = 0.035;            // the ball's radius for lip contact (drawn about twice real size)
const PUTT_MAX = 24;
const LIE_NAME = {tee:'Tee', fairway:'Fairway', fringe:'Fringe', green:'Green', rough:'Rough', bunker:'Bunker', water:'Water', ob:'Out of bounds'};

// ---- difficulty: changes the game, not just the labels ----
// lie: how much of the rough/bunker penalty applies; curve: hook/slice strength; wind; break: how much
// putts curve on slopes; gimme: putts this close are conceded; leaves: how much speed a crown keeps.
const DIFFICULTY = {
  beginner:   {lie: 0.5,  curve: 0.6,  wind: 0.5, brk: 0.7,  gimme: 0.6,  leaves: 1.25, lipIn: 1.4},
  standard:   {lie: 1,    curve: 1,    wind: 1,   brk: 1,    gimme: 0.35, leaves: 1,    lipIn: 1},
  simulation: {lie: 1.25, curve: 1.25, wind: 1.2, brk: 1.15, gimme: 0,    leaves: 0.85, lipIn: 0.8}
};
let D = DIFFICULTY.standard;
function setDifficulty(name){ D = DIFFICULTY[name] || DIFFICULTY.standard; return D; }

// ---- lies (Wii golf style): each lie gives a range of how much of the club's distance you get, and
// woods suffer much more from a bad lie than wedges do ----
const LIE_RANGES = {
  rough:  {wood: [0.55, 0.7],  iron: [0.75, 0.85], wedge: [0.85, 0.95]},
  bunker: {wood: [0.25, 0.35], iron: [0.5, 0.6],   wedge: [0.8, 0.9]},
  fringe: {wood: [0.9, 0.95],  iron: [0.95, 1],    wedge: [0.95, 1]}
};
function lieRange(lie, club){
  const kind = (CLUBS[club] || CLUBS['7i']).kind, t = LIE_RANGES[lie];
  if (!t || kind === 'putter') return [1, 1];
  const r = t[kind] || t.iron;
  return [1 - (1 - r[0]) * D.lie, 1 - (1 - r[1]) * D.lie].map(v => Math.max(0.1, Math.min(1, v)));
}
function lieFactor(lie, club){ const r = lieRange(lie, club); return (r[0] + r[1]) / 2; }
// The putter's range steps up with the length of the putt (as in Wii golf), so a full stroke on a short
// putt only goes a little past the hole instead of off the green.
const PUTT_RANGES = [3, 6, 10, 15, 24];
function puttRange(d){ for (const r of PUTT_RANGES) if (r >= d * 1.3) return r; return PUTT_RANGES[PUTT_RANGES.length - 1]; }

// ---- the ground: bounce and rolling resistance per lie ----
// e: how much of the vertical speed comes back up; keep: horizontal speed kept per bounce;
// mu: rolling resistance (deceleration = mu * g). Greens are quick, rough grabs the ball.
const SURF = {
  green:   {e: 0.22, keep: 0.5,  mu: 0.046},
  fringe:  {e: 0.26, keep: 0.55, mu: 0.08},
  fairway: {e: 0.34, keep: 0.65, mu: 0.12},
  tee:     {e: 0.34, keep: 0.65, mu: 0.12},
  rough:   {e: 0.16, keep: 0.45, mu: 0.18},
  bunker:  {e: 0,    keep: 0,    mu: 9},
  water:   {e: 0,    keep: 0,    mu: 9},
  ob:      {e: 0.3,  keep: 0.6,  mu: 0.15}
};
const surf = l => SURF[l] || SURF.rough;
const STOP = l => l === 'water' || l === 'ob' || l === 'bunker';

// slope pull on a rolling ball (a rolling sphere feels about 5/7 of g along the slope; a little less
// here so greens stay playable)
function slopePull(course, field, lie, x, y){
  const f = field && (lie === 'green' || lie === 'fringe') ? field : course.terrain;
  if (!f) return [0, 0];
  const g = f.grad(x, y), k = G * 0.6 * (lie === 'green' || lie === 'fringe' ? D.brk : 1);
  return [-g[0] * k, -g[1] * k];
}

// The cup. Called every step of a roll. When the ball first reaches the hole, its line decides what
// happens: through the middle and slow enough it drops; too fast it hops over; catching the edge it
// can curl in (lip-in) or spin out round the rim (lip-out). Returns null to keep rolling.
function cupContact(st, cup){
  const dx = st.x - cup[0], dy = st.y - cup[1], dc = Math.hypot(dx, dy), sp = Math.hypot(st.vx, st.vy);
  const outer = CUP + BALL_R * 0.6, inner = CUP - BALL_R * 0.4;
  if (st.willHole){ if (dc < CUP * 0.55 || sp < 0.05) return {holed: true, lipIn: st.willHole === 'lip'}; return null; }
  if (dc > outer){ st.atCup = false; return null; }
  if (st.atCup) return null;                     // already decided on this pass
  st.atCup = true;
  const b = sp > 1e-6 ? Math.abs(dx * st.vy - dy * st.vx) / sp : dc;   // how close its line passes to the middle
  const toward = -(dx * st.vx + dy * st.vy) > 0;
  if (!toward && dc > inner) return null;          // rolling away along the edge
  if (b < inner){
    if (sp < 1.5){ st.willHole = 'in'; return null; }
    if (sp < 2.1 && Math.random() < 0.45 * D.lipIn){ st.willHole = 'lip'; st.vx *= 0.6; st.vy *= 0.6; return null; }   // hits the back wall and drops
    st.vx *= 0.7; st.vy *= 0.7; st.lip = 'over'; return {lip: 'over'};                                                   // too quick: hops over
  }
  const depth = 1 - (b - inner) / (outer - inner);  // 1 = well over the rim, 0 = only just touching
  if (sp < 1.1 && Math.random() < (0.15 + 0.6 * depth) * (1 - sp / 1.6) * D.lipIn){
    // curls in off the rim
    st.willHole = 'lip'; const k = Math.max(0.3, sp * 0.6) / Math.max(dc, 1e-6); st.vx = -dx * k; st.vy = -dy * k; return null;
  }
  // spins out round the rim: turned away from the cup and slowed
  const side = Math.sign(dx * st.vy - dy * st.vx) || 1, turn = -side * (0.5 + depth * 0.7), c = Math.cos(turn), s = Math.sin(turn);
  [st.vx, st.vy] = [(st.vx * c - st.vy * s) * 0.55, (st.vx * s + st.vy * c) * 0.55];
  st.lip = 'out'; return {lip: 'out'};
}

// Roll the ball along the ground from (x, y) with velocity (vx, vy), on real slopes, until it stops.
// track gets [x, y, height, time] points. Used for run-out after full shots and for putts.
function roll(course, st, opts){
  const dt = 1 / 120, track = opts.track, field = opts.field;
  let lie = course.lie(st.x, st.y), still = 0;
  for (let i = 0; i < 120 * 40; i++){
    const sp = Math.hypot(st.vx, st.vy);
    lie = course.lie(st.x, st.y);
    if (STOP(lie)) break;
    const S = surf(lie), fr = S.mu * G * (opts.muK || 1), pull = slopePull(course, field, lie, st.x, st.y), pullN = Math.hypot(pull[0], pull[1]);
    if (sp < 0.04){
      // at rest unless the slope is steeper than the grass can hold (then it starts rolling downhill)
      if (pullN <= fr * 1.15){ if (++still > 3) break; continue; }
      still = 0;
    }
    // rolling resistance slows the ball but never pushes it backwards
    // (plus a little drag, so a ball tumbling down a long bank doesn't run away)
    if (sp > 1e-6){ const dv = (fr + (sp > 4 ? 0.02 * (sp - 4) * (sp - 4) : 0)) * dt; if (dv >= sp){ st.vx = 0; st.vy = 0; } else { st.vx -= st.vx / sp * dv; st.vy -= st.vy / sp * dv; } }
    st.vx += pull[0] * dt; st.vy += pull[1] * dt;
    st.x += st.vx * dt; st.y += st.vy * dt; st.t += dt;
    if (i % 6 === 0) track.push([st.x, st.y, 0, st.t]);
    if (opts.pin){
      const c = cupContact(st, opts.pin);
      if (c){
        if (c.holed){ st.holed = true; st.lipIn = !!c.lipIn; track.push([st.x, st.y, 0, st.t]); return {lie: 'green', holed: true}; }
      }
    }
  }
  track.push([st.x, st.y, 0, st.t]);
  if (opts.pin && st.willHole){ st.holed = true; st.lipIn = st.willHole === 'lip'; return {lie: 'green', holed: true}; }
  return {lie, holed: false};
}

// Bounces after landing: each one loses height and speed depending on the surface.
// Returns the speed left for rolling, or null if the ball stopped dead (bunker, water).
function bounce(course, st, vz, opts){
  const track = opts.track;
  let first = true;
  for (let n = 0; n < 6; n++){
    const lie = course.lie(st.x, st.y);
    if (STOP(lie)) return lie;
    const S = surf(lie);
    vz = vz * S.e;
    let keep = S.keep;
    // spin acts on the first bounce: topspin kicks forward, backspin bites (and can check back on a green)
    if (first && opts.spin){ const t = opts.spin;
      keep *= t > 0 ? 1 + 0.35 * t : 1 + 0.75 * t;
      if (t < -0.4 && (lie === 'green' || lie === 'fringe')) keep -= (-t - 0.4) * 0.9; }
    st.vx *= keep; st.vy *= keep; first = false;
    if (vz < 1.0) return lie;                          // too small to leave the ground: it rolls from here
    const tb = 2 * vz / G, steps = Math.max(4, Math.round(tb / 0.04));
    const H = course.terrain ? (x, y) => course.terrain.height(x, y) : () => 0, z0 = H(st.x, st.y);
    for (let k = 1; k <= steps; k++){
      const t = tb * k / steps, x = st.x + st.vx * t, y = st.y + st.vy * t, z = z0 + vz * t - G * t * t / 2;
      const h = Math.max(0, z - H(x, y));
      track.push([x, y, h, st.t + t]);
      if (k > 1 && h <= 0 && z - H(x, y) < -0.02){ st.x = x; st.y = y; st.t += t; break; }   // landed early on a rise
      if (k === steps){ st.x = x; st.y = y; st.t += t; }
    }
    if (opts.pin && Math.hypot(st.x - opts.pin[0], st.y - opts.pin[1]) < CUP * 0.8 && vz < 2.5){ st.holed = true; return 'green'; }
  }
  return course.lie(st.x, st.y);
}

// Full shot. Returns the flight samples for animation plus where the ball ends up.
// s: {from, ang, club, power, lie, lieK?, wind?, side?, pin?, spin? {top, side}, field?}
function fullShot(course, s){
  const C = CLUBS[s.club], ang = s.ang, ux = Math.cos(ang), uy = Math.sin(ang), rx = Math.sin(ang), ry = -Math.cos(ang); // right of aim
  const spin = s.spin || {top: 0, side: 0}, top = Math.max(-1, Math.min(1, spin.top || 0)), sideSpin = Math.max(-1, Math.min(1, spin.side || 0));
  let carry = C.max * Math.pow(Math.max(0.02, s.power), 0.9) * (s.lieK ?? lieFactor(s.lie, s.club));
  carry *= 1 - 0.03 * Math.abs(top);                                   // spin costs a little carry
  const wind = s.wind ? [s.wind[0] * D.wind, s.wind[1] * D.wind] : null;
  const along = wind ? wind[0]*ux + wind[1]*uy : 0, cross = wind ? wind[0]*rx + wind[1]*ry : 0;
  carry *= 1 + along * 0.012 * C.wind;
  const drift = cross * 0.9 * C.wind * carry / 100;
  // metres right (+) / left (-): the face from the swing, plus side spin chosen on the ball
  const curve = (s.side || 0) + sideSpin * 0.07 * carry * Math.max(0.4, C.curve);
  // short shots fly lower: a 30 m pitch peaks around 8 m, a full drive around 28 m; topspin flies lower, backspin higher
  const apex = C.apex * Math.max(0.25, Math.min(1, carry / C.max)) * (s.lie === 'bunker' ? 0.9 : 1) * (1 - 0.15 * top);
  // the ball flies over real ground: it lands sooner going uphill and later going downhill
  const H = course.terrain ? (x, y) => course.terrain.height(x, y) : () => 0, z0 = H(s.from[0], s.from[1]);
  const pos = t => { const a = carry * t, sd = curve * t * t + drift * t, x = s.from[0] + ux*a + rx*sd, y = s.from[1] + uy*a + ry*sd;
    return [x, y, z0 + apex * 4 * t * (1 - t) - H(x, y)]; };          // [x, y, height above the ground there]
  const samples = [], seen = new Set(); let hitTree = null, leaves = 0, dropped = null;
  const N = Math.max(40, Math.round(carry / 2));
  // Like Wii golf, leaves don't stop the ball: it crashes through, losing speed, and drops out
  // the other side. Only a trunk (or the dense middle of a crown, now and then) knocks it back.
  const T = Math.sqrt(8 * Math.max(apex, 1) / G), dt = T / N;   // flight time, and time per sample
  let landT = 1;
  for (let i = 0; i <= N * 1.8; i++){
    const t = i / N; let p = pos(t);
    if (t > 0.3 && p[2] <= 0){ p[2] = 0; samples.push(p); landT = t; break; }     // touched down
    samples.push(p);
    if (i > 2 && p[2] < 32){
      let hit = null;
      for (const tr of course.treesNear(p[0], p[1])){ if (seen.has(tr)) continue; const h = GolfTrees.hits(tr, p[0], p[1], p[2]); if (h){ hit = [tr, h]; break; } }
      if (hit){
        const [tr, h] = hit; seen.add(tr);
        const trunk = p[2] < tr.base;
        if (trunk || (h === 'inner' && Math.random() < 0.18 / D.leaves)){ hitTree = tr; break; }
        // through the leaves: carry on from here, slowed, falling
        leaves++; dropped = {t, p, vz: 4 * apex * (1 - 2 * t) / T, keep: Math.min(0.9, (h === 'inner' ? 0.3 + Math.random() * 0.2 : 0.5 + Math.random() * 0.2) * D.leaves)};
        break;
      }
    }
  }
  let vxL = (ux * carry + rx * (2 * curve * landT + drift)) / T, vyL = (uy * carry + ry * (2 * curve * landT + drift)) / T;   // ground speed at landing
  let vzL = 4 * apex * (2 * landT - 1) / T;
  if (dropped){
    // horizontal speed along the shot, plus any sideways drift, scaled down by the leaves
    const q = pos(dropped.t + 1 / N), vx0 = (q[0] - dropped.p[0]) / dt, vy0 = (q[1] - dropped.p[1]) / dt;
    let vx = vx0 * dropped.keep, vy = vy0 * dropped.keep, vz = Math.min(0, dropped.vz) * 0.4, x = dropped.p[0], y = dropped.p[1], z = dropped.p[2] + H(x, y);
    for (let k = 0; k < 400; k++){
      x += vx * dt; y += vy * dt; z += vz * dt; vz -= G * dt;
      // another tree on the way down slows it again (once each)
      const above = z - H(x, y);
      for (const tr of course.treesNear(x, y)){ if (seen.has(tr)) continue; const h = GolfTrees.hits(tr, x, y, above); if (h && above >= tr.base){ seen.add(tr); leaves++; vx *= 0.55; vy *= 0.55; } }
      if (above <= 0){ samples.push([x, y, 0]); break; }
      samples.push([x, y, above]);
    }
    vxL = vx; vyL = vy; vzL = -vz;
  }
  let land = samples[samples.length - 1];
  const events = [];
  if (leaves) events.push('leaves');
  if (hitTree){
    events.push('tree');
    // off the trunk: drops nearly straight down, sometimes kicking back
    const back = -1 + Math.random() * 4;
    land = [land[0] - ux*back + (Math.random() - .5)*3, land[1] - uy*back + (Math.random() - .5)*3, 0];
    samples.push([land[0], land[1], 0]);
    vxL = ux * 0.8; vyL = uy * 0.8; vzL = 2;
  }
  // ---- bounce and run out ----
  // The flight above has no air drag, so its landing speed is too high. Instead, the ball comes down with
  // the speed that gives each club its usual run-out on a flat fairway (driver ~12% of carry), scaled
  // by spin; the bounces and the roll then play out on the real ground, lies and slopes.
  const runRef = (hitTree ? 0.5 : leaves ? 1.5 + Math.random() * 2 : carry * C.roll) * (top > 0 ? 1 + 1.0 * top : 1 + 0.75 * top) * (1 + along * 0.01);
  const vRoll = Math.sqrt(2 * SURF.fairway.mu * G * Math.max(0.05, runRef)) / 0.42;   // ~ two fairway bounces' worth of speed lost
  const vh = Math.hypot(vxL, vyL) || 1, k = vRoll / vh;
  const st = {x: land[0], y: land[1], vx: vxL * k, vy: vyL * k, t: 0};
  const vzIn = Math.min(12, Math.max(2, Math.abs(vzL) * 0.5));
  const rollTrack = [[land[0], land[1], 0, 0]];
  let lie = course.lie(land[0], land[1]), holed = false, lip = null;
  if (!STOP(lie)){
    lie = bounce(course, st, vzIn, {track: rollTrack, spin: hitTree ? 0 : top, pin: s.pin});
    if (st.holed){ holed = true; }
    else if (!STOP(lie)){
      const r = roll(course, st, {track: rollTrack, pin: s.pin, field: s.field});
      lie = r.lie; holed = r.holed; lip = st.lip || null;
    }
  }
  let rest = [st.x, st.y];
  if (holed){ rest = s.pin.slice(); lie = 'green'; }
  if (lip) events.push('lip');
  return {samples, rollTrack, land, rest, lie, holed, lipIn: !!st.lipIn, events, carry: Math.hypot(land[0] - s.from[0], land[1] - s.from[1]),
    total: Math.hypot(rest[0] - s.from[0], rest[1] - s.from[1]), apex, curve};
}

// Putt. s.max is the putter's range for this putt; s.field (optional) is the green's slope surface.
// Works from the fringe and rough too.
function putt(course, s){
  // a little more pop in softer strokes, so putts don't come up short
  const Dist = Math.max(0.15, (s.max || PUTT_MAX) * Math.pow(Math.max(0, s.power), 0.85));
  const v = Math.sqrt(2 * SURF.green.mu * G * Dist);
  const st = {x: s.from[0], y: s.from[1], vx: Math.cos(s.ang) * v, vy: Math.sin(s.ang) * v, t: 0};
  const track = [[st.x, st.y, 0, 0]];
  const r = roll(course, st, {track, pin: s.pin, field: s.field});
  const end = track[track.length - 1];
  return {track, rest: r.holed ? s.pin.slice() : [end[0], end[1]], lie: r.holed ? 'green' : r.lie, holed: r.holed, lipIn: !!st.lipIn,
    lip: st.lip || null, entry: r.holed ? [st.vx, st.vy] : null};
}

// Walk back along a flight to the last dry point (for water drops).
function dropPoint(course, samples, from){
  for (let i = samples.length - 1; i >= 0; i--){ const p = samples[i]; const l = course.lie(p[0], p[1]); if (l !== 'water' && l !== 'ob') return [p[0], p[1]]; }
  return from.slice();
}

window.GolfPhysics = {CLUBS, ORDER, LIE_NAME, CUP, BALL_R, PUTT_MAX, SURF, DIFFICULTY, setDifficulty, get difficulty(){ return D; },
  lieFactor, lieRange, puttRange, fullShot, putt, roll, bounce, cupContact, dropPoint};
})();
