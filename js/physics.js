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
const CUP = 0.132;           // 10% bigger again in version 14
const BALL_R = 0.035;            // the ball's radius for rim contact (drawn about twice real size)
const PUTT_MAX = 22;
const LIE_NAME = {tee:'Tee', fairway:'Fairway', fringe:'Fringe', green:'Green', rough:'Rough', bunker:'Bunker', water:'Water', ob:'Out of bounds'};

// ---- difficulty: changes the game, not just the labels ----
// lie: how much of the rough/bunker penalty applies; curve: hook/slice strength; wind; break: how much
// putts curve on slopes; gimme: putts this close are conceded; leaves: how much speed a crown keeps.
// One setting for everyone (version 15). It keeps the putting, cup and green-reading feel of the old
// Beginner level, with more of the wind and the curve on hooks and slices.
const DIFFICULTY = {
  game: {lie: 0.6, curve: 0.75, wind: 1.4, brk: 0.7, gimme: 0.6, leaves: 1.25, lipIn: 1.4}
};
let D = DIFFICULTY.game;
function setDifficulty(){ return D; }   // kept so older callers don't break

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
// A natural, medium stroke (about 60%) gets a putt to the hole; a full one sends it well past.
// One fixed putter (version 15): a full stroke always rolls PUTT_MAX on a flat green and shorter putts
// just take less of a stroke. The stroke maps to distance as power^1.6, so the short putts you hit most
// get the most of the bar: 1 m ≈ 20%, 3 m ≈ 32%, 6 m ≈ 47%, 10 m ≈ 63%, 22 m = 100%.
const PUTT_EXP = 1.6;
function puttRange(){ return PUTT_MAX; }
function puttPower(d){ return Math.pow(Math.max(0, d) / PUTT_MAX, 1 / PUTT_EXP); }

// ---- the ground: bounce and rolling resistance per lie ----
// e1: how much of the real descent speed comes back up on the first bounce (the turf soaks up most of
// a steep landing); e: the same for the smaller hops after it; keep: speed along the ground kept per
// hop; mu: rolling resistance (deceleration = mu * g). Greens are quick, rough grabs the ball.
// (v18: higher bounces, from the ball's real descent: a drive kicks up about 3 m on a fairway.)
const SURF = {
  green:   {e1: 0.2,  e: 0.3,  keep: 0.7,  mu: 0.052},
  fringe:  {e1: 0.24, e: 0.32, keep: 0.7,  mu: 0.08},
  fairway: {e1: 0.32, e: 0.4,  keep: 0.8,  mu: 0.12},
  tee:     {e1: 0.32, e: 0.4,  keep: 0.8,  mu: 0.12},
  rough:   {e1: 0.18, e: 0.25, keep: 0.55, mu: 0.18},
  bunker:  {e1: 0,    e: 0,    keep: 0,    mu: 9},
  water:   {e1: 0,    e: 0,    keep: 0,    mu: 9},
  ob:      {e1: 0.3,  e: 0.35, keep: 0.7,  mu: 0.15}
};
const QDRAG = 0.02;   // a ball rolling faster than 4 m/s (down a long bank) is slowed a little more
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

// ---- the cup, as real physics ----
// The ball rolls on the green until its centre passes over the hole. From then on it is in the air:
// it falls under gravity while carrying its speed, and bumps off the rim (the cup's top edge), the cup
// wall and the flagstick like a real ball would. Slow and through the middle it simply drops; firm and
// central it hits the back wall and falls; too quick it skims across and jumps the far lip; catching
// the side, the rim turns it and it can curl in (lip-in) or spin out (lip-out). No dice rolls.
const CUP_DEPTH = 0.105;         // how far the ball's centre can sink (the drawn cup is 11 cm deep)
const FLAG_R = 0.0125, FLAG_H = 2.1;
// The cup and ball are drawn bigger than real, so the fall is scaled to keep real capture speeds:
// a putt dead at the middle drops up to about 1.6 m/s (as measured on real greens), less off-centre;
// with the flagstick in (chips and full shots) a central ball holds up to about 2.8 m/s.
const CUP_G = 2.5;   // (v16: a softer rim, so firm putts at the middle drop more often: up to ~2.4 m/s)
function cupStep(st, cup, dt, flag){
  const Rc = CUP, Rb = BALL_R, g = CUP_G * D.lipIn;
  st.vz += g * dt; st.z += st.vz * dt; st.x += st.vx * dt; st.y += st.vy * dt;
  let dx = st.x - cup[0], dy = st.y - cup[1], dc = Math.hypot(dx, dy);
  const ux = dc > 1e-9 ? dx / dc : 1, uy = dc > 1e-9 ? dy / dc : 0;
  const hit = (nx, ny, nz, e, fric, kind) => {   // bounce off a surface with normal n (z up)
    const vup = -st.vz, vn = st.vx * nx + st.vy * ny + vup * nz;
    if (vn >= 0) return false;
    if (vn > -0.25){ e = 0; fric = 1; }          // a gentle touch rolls along the edge rather than bouncing
    let vx = st.vx - (1 + e) * vn * nx, vy = st.vy - (1 + e) * vn * ny, vu = vup - (1 + e) * vn * nz;
    const vn2 = vx * nx + vy * ny + vu * nz;     // friction on the sliding part
    vx = vn2 * nx + (vx - vn2 * nx) * fric; vy = vn2 * ny + (vy - vn2 * ny) * fric; vu = vn2 * nz + (vu - vn2 * nz) * fric;
    st.vx = vx; st.vy = vy; st.vz = -vu; st.contacts = (st.contacts || 0) + 1; if (kind) st[kind] = true; return true;
  };
  // the flagstick (it stays in, as most golfers now leave it): soaks up pace, so the ball drops
  if (flag && dc < FLAG_R + Rb && Rb - st.z < FLAG_H){
    const push = FLAG_R + Rb - dc; st.x += ux * push; st.y += uy * push; dc = FLAG_R + Rb;
    hit(ux, uy, 0, 0.3, 0.7, 'flagHit');
  }
  if (dc < Rc){
    // the rim edge (a circle at ground level) or, once the ball is below it, the cup wall
    const hc = Rb - st.z, gh = Rc - dc, vz = Math.max(0, hc), d = Math.hypot(gh, vz);
    if (d < Rb && d > 1e-9){
      const nx = -ux * gh / d, ny = -uy * gh / d, nz = vz / d, push = Rb - d;
      st.x += nx * push; st.y += ny * push; st.z -= nz * push;
      hit(nx, ny, nz, 0.3, 0.85, hc > 0 ? 'rimHit' : 'wallHit');
    }
    if (st.z >= CUP_DEPTH){ st.z = CUP_DEPTH; st.vz = 0; st.vx *= 0.5; st.vy *= 0.5; }   // the bottom
  } else if (st.z > 0){
    // outside the hole but below ground level: it has hit the edge from inside; sit it on the rim
    st.z = 0; if (st.vz > 0) st.vz = 0;
  }
  return Math.hypot(st.x - cup[0], st.y - cup[1]);
}

// Roll the ball along the ground from (x, y) with velocity (vx, vy), on real slopes, until it stops.
// track gets [x, y, height, time] points (height < 0 = below the rim, in the cup). Used for run-out
// after full shots and for putts. st.z/st.vz (optional): it starts in the air above the hole.
function roll(course, st, opts){
  const dt = 1 / 120, track = opts.track, field = opts.field, pin = opts.pin, flag = opts.flag !== false;
  let lie = course.lie(st.x, st.y), still = 0;
  st.z = st.z || 0; st.vz = st.vz || 0;
  let air = !!(pin && (st.z < 0 || Math.hypot(st.x - pin[0], st.y - pin[1]) < CUP));
  let entry = null;
  for (let i = 0; i < 120 * 40; i++){
    if (air){
      // over the hole (or hopping off its edge): small steps for the collisions
      if (!entry){ entry = {vx: st.vx, vy: st.vy, b: Math.abs((st.x - pin[0]) * st.vy - (st.y - pin[1]) * st.vx) / (Math.hypot(st.vx, st.vy) || 1)}; }
      const n = 10; let dc = 0;
      for (let k = 0; k < n; k++) dc = cupStep(st, pin, dt / n, flag);
      st.t += dt; track.push([st.x, st.y, -st.z, st.t]);
      // in: below the rim with nowhere to go (it can't jump back out from there)
      if (st.z > BALL_R * 2 + 0.005 || (st.z >= CUP_DEPTH - 1e-6)){
        if (!st.holed){ st.holed = true; st.holeT = st.t; }
        if (st.t - st.holeT > 0.35 || (st.z >= CUP_DEPTH - 1e-6 && Math.hypot(st.vx, st.vy) < 0.02)){
          st.lipIn = !!(st.rimHit && entry.b > CUP * 0.55);
          return {lie: 'green', holed: true};
        }
        continue;
      }
      // out: back on the green outside the hole
      if (dc >= CUP && st.z >= -1e-4){
        air = false; st.z = 0; st.vz = 0;
        if (st.contacts){
          const a0 = Math.atan2(entry.vy, entry.vx), a1 = Math.atan2(st.vy, st.vx);
          const turn = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)));
          st.lip = turn > 0.35 ? 'out' : 'over';
        }
        entry = null;
      }
      continue;
    }
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
    if (sp > 1e-6){ const dv = (fr + (opts.drag || 0) * sp + (sp > 4 ? QDRAG * (sp - 4) * (sp - 4) : 0)) * dt; if (dv >= sp){ st.vx = 0; st.vy = 0; } else { st.vx -= st.vx / sp * dv; st.vy -= st.vy / sp * dv; } }
    st.vx += pull[0] * dt; st.vy += pull[1] * dt;
    // step in pieces near the hole so a quick ball can't skip over it
    const nearCup = pin && Math.hypot(st.x - pin[0], st.y - pin[1]) < CUP + sp * dt + 0.05;
    const n = nearCup ? 8 : 1;
    for (let k = 0; k < n; k++){
      st.x += st.vx * dt / n; st.y += st.vy * dt / n;
      if (pin && Math.hypot(st.x - pin[0], st.y - pin[1]) < CUP){ air = true; st.z = 0; st.vz = 0; break; }
    }
    st.t += dt;
    if (air || i % 6 === 0) track.push([st.x, st.y, 0, st.t]);
  }
  track.push([st.x, st.y, 0, st.t]);
  return {lie, holed: false};
}

// The ball meets the ground: velocity (st.vx, st.vy, -down) bounces off the real slope there. Along the
// ground it keeps `keep` of its speed, and `e` of its speed into the ground comes back out, so a ball
// landing on a downslope kicks on and one landing into a bank stops. Returns the upward speed.
function contact(course, st, down, e, keep){
  let gx = 0, gy = 0;
  if (course.terrain){ const H = (x, y) => course.terrain.height(x, y), d = 1.5;
    gx = (H(st.x + d, st.y) - H(st.x - d, st.y)) / (2 * d); gy = (H(st.x, st.y + d) - H(st.x, st.y - d)) / (2 * d);
    const gl = Math.hypot(gx, gy); if (gl > 0.5){ gx *= 0.5 / gl; gy *= 0.5 / gl; } }
  const nl = Math.hypot(gx, gy, 1), nx = -gx / nl, ny = -gy / nl, nz = 1 / nl;
  const vn = st.vx * nx + st.vy * ny - down * nz;
  if (vn >= 0){ st.vx *= keep; st.vy *= keep; return 0; }
  const tx = st.vx - vn * nx, ty = st.vy - vn * ny, tz = -down - vn * nz;
  st.vx = tx * keep - e * vn * nx; st.vy = ty * keep - e * vn * ny;
  return Math.max(0, tz * keep - e * vn * nz);
}
// How far a ball runs on flat ground after its first bounce, given the speed up (vz) and along (u):
// the hops that follow plus the roll. Used to set the run-out (see fullShot).
function flatRun(S, vz, u){
  let d = 0;
  for (let n = 0; n < 8 && vz >= 1.0; n++){ d += u * 2 * vz / G; vz *= S.e; u *= S.keep; }
  const dt = 1 / 60;
  for (let i = 0; i < 6000 && u > 0; i++){ d += u * dt; u -= (S.mu * G + (u > 4 ? QDRAG * (u - 4) * (u - 4) : 0)) * dt; }
  return d;
}
function speedForRun(S, vz, R){
  let lo = 0, hi = 60;
  for (let k = 0; k < 30; k++){ const m = (lo + hi) / 2; if (flatRun(S, vz, m) < R) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// Hops after the first bounce: st holds the speed along the ground, vz the speed up. Each landing
// loses height and pace depending on the surface and bounces off the real slope.
// Returns the lie where it settles into a roll (or stopped dead: bunker, water).
function bounce(course, st, vz, opts){
  const track = opts.track;
  for (let n = 0; n < 8; n++){
    const lie = course.lie(st.x, st.y);
    if (STOP(lie)) return lie;
    if (n > 0){ const S = surf(lie); vz = contact(course, st, vz, S.e, S.keep); }
    if (vz < 1.0) return lie;                          // too small to leave the ground: it rolls from here
    const tb = 2 * vz / G, steps = Math.max(4, Math.round(tb / 0.04));
    const H = course.terrain ? (x, y) => course.terrain.height(x, y) : () => 0, z0 = H(st.x, st.y);
    for (let k = 1; k <= steps; k++){
      const t = tb * k / steps, x = st.x + st.vx * t, y = st.y + st.vy * t, z = z0 + vz * t - G * t * t / 2;
      const h = Math.max(0, z - H(x, y));
      // coming down onto the hole or into the flagstick: hand over to the cup physics
      if (opts.pin && k > 1 && h < FLAG_H){
        const dc = Math.hypot(x - opts.pin[0], y - opts.pin[1]), down = vz - G * t < 0;
        if ((dc < CUP && down && h < 0.4) || dc < FLAG_R + BALL_R + 0.01){
          st.x = x; st.y = y; st.t += t; st.z = -h; st.vz = Math.max(0, G * t - vz); return 'green';
        }
      }
      track.push([x, y, h, st.t + t]);
      if (k > 1 && h <= 0 && z - H(x, y) < -0.02){ st.x = x; st.y = y; st.t += t; break; }   // landed early on a rise
      if (k === steps){ st.x = x; st.y = y; st.t += t; }
    }
    if (opts.pin && Math.hypot(st.x - opts.pin[0], st.y - opts.pin[1]) < CUP){ st.z = 0; st.vz = vz * 0.3; return 'green'; }   // landed on the hole
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
  // air drag: the ball leaves fast and slows down, so it peaks past halfway and comes down steeper
  // than it went up (a drive lands at about 40 degrees)
  const KD = 0.9, W = t => (1 - Math.exp(-KD * t)) / (1 - Math.exp(-KD)), Wd = t => KD * Math.exp(-KD * t) / (1 - Math.exp(-KD));
  const pos = t => { const a = carry * W(t), sd = curve * t * t + drift * t, x = s.from[0] + ux*a + rx*sd, y = s.from[1] + uy*a + ry*sd;
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
  let vxL = (ux * carry * Wd(landT) + rx * (2 * curve * landT + drift)) / T, vyL = (uy * carry * Wd(landT) + ry * (2 * curve * landT + drift)) / T;   // ground speed at landing
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
  // ---- bounce and run out (v18) ----
  // The ball comes down at its real descent speed, so the first bounce is as high as a real one (a drive
  // kicks up about 3 m off a fairway, a wedge into a green under a metre) and later hops die away. The pace
  // it keeps along the ground is set so that, on flat ground, the hops plus the roll come to the club's
  // usual run-out for the lie: about 9% of carry for a driver, 5% for a 7 iron, more for chips; greens
  // and rough take most of it away. Slopes then do the rest (a downslope kicks it on, a bank stops it),
  // and the roll slows at a steady rate, like a real ball, instead of braking hard and creeping.
  const RO = {Dr: 0.088, '3W': 0.08, '5i': 0.06, '7i': 0.052, '9i': 0.047, PW: 0.045, SW: 0.042};
  const LAND = {green: 0.4, fringe: 0.5, fairway: 1, tee: 1, rough: 0.3, ob: 0.6};
  // part shots (chips and pitches) run out more for their length than full swings do
  const CHIP = {Dr: 0.08, '3W': 0.12, '5i': 0.16, '7i': 0.2, '9i': 0.24, PW: 0.24, SW: 0.28}, cfr = Math.min(1, carry / C.max);
  const rollFrac = (RO[s.club] || 0.05) + (CHIP[s.club] || 0.16) * (1 - cfr) * (1 - cfr);
  const lie0 = course.lie(land[0], land[1]), S0 = surf(lie0);
  // backspin: wedges zip it back on a green; longer clubs barely check
  const SPINK = {Dr: 0.4, '3W': 0.5, '5i': 0.7, '7i': 0.9, '9i': 1.15, PW: 1.35, SW: 1.6};
  const tEff = hitTree ? 0 : top * (SPINK[s.club] || 1), cf = Math.min(1, carry / C.max);
  const zip = tEff < -0.25 && (lie0 === 'green' || lie0 === 'fringe') ? 1.7 * Math.min(1.25, -tEff - 0.25) * Math.pow(cf, 0.7) : 0;
  let runRef = (hitTree ? 0.5 : leaves ? 1.5 + Math.random() * 2 : carry * rollFrac) * (top > 0 ? 1 + 1.0 * top : 1) * (1 + along * 0.01) * (LAND[lie0] ?? 1);
  if (tEff < 0 && !zip) runRef *= Math.max(0.15, 1 + 0.6 * tEff);      // backspin on grass: it checks up
  const down = Math.min(30, Math.max(1.5, Math.abs(vzL)));
  let up = down * (S0.e1 || 0) * (zip ? 0.6 : 1);
  const vh = Math.hypot(vxL, vyL) || 1;
  // the pace it should leave the first bounce with (backwards, if the wedge zips it)
  const u = zip ? -zip : speedForRun(S0, up, Math.max(0.05, runRef));
  const st = {x: land[0], y: land[1], vx: vxL, vy: vyL, t: 0};
  const rollTrack = [[land[0], land[1], 0, 0]];
  let lie = lie0, holed = false, lip = null;
  if (!STOP(lie)){
    if (s.pin && Math.hypot(land[0] - s.pin[0], land[1] - s.pin[1]) < CUP){ st.vx = vxL / vh * u; st.vy = vyL / vh * u; st.z = 0; st.vz = Math.min(16, down * 0.65); lie = 'green'; }   // straight in the hole
    else {
      if (zip){ st.vx = vxL / vh * u; st.vy = vyL / vh * u; }
      else up = contact(course, st, down, S0.e1, u / vh);
      lie = bounce(course, st, up, {track: rollTrack, pin: s.pin});
    }
    if (!STOP(lie)){
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
  const Dist = Math.max(0.15, (s.max || PUTT_MAX) * Math.pow(Math.max(0, s.power), PUTT_EXP));
  const v = Math.sqrt(2 * SURF.green.mu * G * Dist);
  const st = {x: s.from[0], y: s.from[1], vx: Math.cos(s.ang) * v, vy: Math.sin(s.ang) * v, t: 0};
  const track = [[st.x, st.y, 0, 0]];
  const r = roll(course, st, {track, pin: s.pin, field: s.field, flag: !!s.flag});   // the flag comes out for putts, as in Wii golf
  const end = track[track.length - 1];
  return {track, rest: r.holed ? s.pin.slice() : [end[0], end[1]], lie: r.holed ? 'green' : r.lie, holed: r.holed, lipIn: !!st.lipIn,
    lip: st.lip || null, flag: !!st.flagHit};
}

// Walk back along a flight to the last dry point (for water drops).
function dropPoint(course, samples, from){
  for (let i = samples.length - 1; i >= 0; i--){ const p = samples[i]; const l = course.lie(p[0], p[1]); if (l !== 'water' && l !== 'ob') return [p[0], p[1]]; }
  return from.slice();
}

window.GolfPhysics = {CLUBS, ORDER, LIE_NAME, CUP, BALL_R, PUTT_MAX, SURF, DIFFICULTY, setDifficulty, get difficulty(){ return D; },
  lieFactor, lieRange, puttRange, puttPower, PUTT_EXP, fullShot, putt, roll, bounce, cupStep, dropPoint, CUP_DEPTH};
})();
