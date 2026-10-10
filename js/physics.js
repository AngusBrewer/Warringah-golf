// Shot and putt simulation. Pure functions of the course, so they can be tested on their own.
(function(){
'use strict';

const CLUBS = {
  Dr: {name:'Driver',         max:230, apex:28, roll:0.12, curve:1.0,  wind:1.0},
  '3W': {name:'3 wood',       max:210, apex:26, roll:0.10, curve:0.9,  wind:0.95},
  '5i': {name:'5 iron',       max:170, apex:24, roll:0.07, curve:0.7,  wind:0.85},
  '7i': {name:'7 iron',       max:150, apex:25, roll:0.05, curve:0.6,  wind:0.8},
  '9i': {name:'9 iron',       max:125, apex:27, roll:0.04, curve:0.5,  wind:0.75},
  PW: {name:'Pitching wedge', max:105, apex:28, roll:0.03, curve:0.4,  wind:0.7},
  SW: {name:'Sand wedge',     max:80,  apex:24, roll:0.02, curve:0.35, wind:0.6},
  Pt: {name:'Putter',         max:20,  apex:0,  roll:0,    curve:0,    wind:0, putt:true}
};
const ORDER = ['Dr','3W','5i','7i','9i','PW','SW','Pt'];
// how much of the club's distance you get from each lie
const LIE_DIST = {tee:1, fairway:1, fringe:0.95, green:1, rough:0.86, bunker:0.62};
// how far the ball runs after landing, relative to the club's normal roll
const LIE_ROLL = {tee:1, fairway:1, fringe:0.7, green:0.55, rough:0.3, bunker:0, water:0, ob:0};
const LIE_NAME = {tee:'Tee', fairway:'Fairway', fringe:'Fringe', green:'Green', rough:'Rough', bunker:'Bunker', water:'Water', ob:'Out of bounds'};

function lieFactor(lie, club){ if (lie === 'bunker' && (club === 'SW' || club === 'PW')) return 0.85; return LIE_DIST[lie] ?? 0.86; }

// Full shot. Returns the flight samples for animation plus where the ball ends up.
function fullShot(course, s){
  const C = CLUBS[s.club], ang = s.ang, ux = Math.cos(ang), uy = Math.sin(ang), rx = Math.sin(ang), ry = -Math.cos(ang); // right of aim
  let carry = C.max * Math.pow(Math.max(0.02, s.power), 0.9) * lieFactor(s.lie, s.club);
  const along = s.wind ? s.wind[0]*ux + s.wind[1]*uy : 0, cross = s.wind ? s.wind[0]*rx + s.wind[1]*ry : 0;
  carry *= 1 + along * 0.012 * C.wind;
  const drift = cross * 0.9 * C.wind * carry / 100;
  let curve = s.side || 0;                                 // metres right (+) / left (-) from the face
  // short shots fly lower: a 30 m pitch peaks around 8 m, a full drive around 28 m
  const apex = C.apex * Math.max(0.25, Math.min(1, carry / C.max)) * (s.lie === 'bunker' ? 0.9 : 1);
  // the ball flies over real ground: it lands sooner going uphill and later going downhill
  const H = course.terrain ? (x, y) => course.terrain.height(x, y) : () => 0, z0 = H(s.from[0], s.from[1]);
  const pos = t => { const a = carry * t, sd = curve * t * t + drift * t, x = s.from[0] + ux*a + rx*sd, y = s.from[1] + uy*a + ry*sd;
    return [x, y, z0 + apex * 4 * t * (1 - t) - H(x, y)]; };          // [x, y, height above the ground there]
  const samples = [], luck = new Map(); let hitTree = null, endT = 1;
  const N = Math.max(40, Math.round(carry / 2));
  for (let i = 0; i <= N * 1.8; i++){
    const t = i / N; let p = pos(t);
    if (t > 0.3 && p[2] <= 0){ p[2] = 0; samples.push(p); break; }     // touched down
    samples.push(p);
    if (i > 2 && p[2] < 32){
      for (const tr of course.treesNear(p[0], p[1])){
        const h = GolfTrees.hits(tr, p[0], p[1], p[2]); if (!h) continue;
        if (h === 'outer'){ if (!luck.has(tr)) luck.set(tr, Math.random() < 0.35); if (!luck.get(tr)) continue; }   // one roll of the dice per tree
        hitTree = tr; endT = t; break;
      }
    }
    if (hitTree) break;
  }
  let land = samples[samples.length - 1];
  const events = [];
  if (hitTree){
    events.push('tree');
    // drop out of the tree, kicking back a little
    const back = 2 + Math.random() * 4;
    land = [land[0] - ux*back + (Math.random() - .5)*3, land[1] - uy*back + (Math.random() - .5)*3, 0];
    samples.push([land[0], land[1], 0]);
  }
  // roll
  const dirX = hitTree ? ux : ux + rx * 2 * (curve / Math.max(30, carry)), dirY = hitTree ? uy : uy + ry * 2 * (curve / Math.max(30, carry));
  const dl = Math.hypot(dirX, dirY), dx = dirX / dl, dy = dirY / dl;
  let lie = course.lie(land[0], land[1]);
  const rollTrack = [[land[0], land[1]]];
  let rest = [land[0], land[1]], holed = false;
  if (lie !== 'water' && lie !== 'ob' && lie !== 'bunker'){
    let remaining = (hitTree ? 1 : carry * C.roll * (LIE_ROLL[lie] ?? 0.3)) * (1 + along * 0.01);
    let x = land[0], y = land[1];
    while (remaining > 0.05){
      const step = Math.min(0.5, remaining); x += dx * step; y += dy * step;
      const l = course.lie(x, y);
      const g = course.terrain ? course.terrain.grad(x, y) : [0, 0], up = g[0]*dx + g[1]*dy;   // rolls further downhill
      remaining -= step * (l === 'rough' ? 3 : l === 'fringe' ? 1.6 : 1) * Math.max(0.3, 1 + up * 12);
      if (s.pin && Math.hypot(x - s.pin[0], y - s.pin[1]) < 0.09 && remaining < 2.5){ holed = true; x = s.pin[0]; y = s.pin[1]; lie = 'green'; rollTrack.push([x, y]); break; }
      rollTrack.push([x, y]); lie = l;
      if (l === 'water' || l === 'ob' || l === 'bunker') break;
    }
    rest = [x, y];
  }
  if (!holed && s.pin && Math.hypot(rest[0] - s.pin[0], rest[1] - s.pin[1]) < 0.08){ holed = true; rest = s.pin.slice(); }
  return {samples, rollTrack, land, rest, lie, holed, events, carry: Math.hypot(land[0] - s.from[0], land[1] - s.from[1])};
}

// Putt. s.field (optional) is the green's slope surface; works from the fringe and rough too.
function putt(course, s){
  const ang = s.ang, D = Math.max(0.3, 20 * s.power * (s.max ? s.max / 20 : 1));
  const decel = 0.55, cup = s.pin;
  let v = Math.sqrt(2 * decel * D), vx = Math.cos(ang) * v, vy = Math.sin(ang) * v;
  let x = s.from[0], y = s.from[1], holed = false, lie = 'green', lip = false;
  const track = [[x, y]], dt = 1/120;
  for (let i = 0; i < 120 * 30; i++){
    const sp = Math.hypot(vx, vy); if (sp < 0.03) break;
    const l = course.lie(x, y);
    const k = l === 'green' ? 1 : l === 'fringe' ? 1.8 : l === 'rough' ? 4.5 : l === 'tee' || l === 'fairway' ? 1.4 : 4;
    const a = decel * k;
    vx -= (vx / sp) * a * dt; vy -= (vy / sp) * a * dt;
    const fld = s.field && (l === 'green' || l === 'fringe') ? s.field : course.terrain;   // off the green, the ground's own slope
    if (fld){ const a2 = GolfGreens.slopeAccel(fld, x, y); vx += a2[0] * dt; vy += a2[1] * dt; }
    if (Math.hypot(vx, vy) > sp) { const n = Math.hypot(vx, vy); vx *= sp / n; vy *= sp / n; }
    x += vx * dt; y += vy * dt;
    if (i % 6 === 0) track.push([x, y]);
    const dc = Math.hypot(x - cup[0], y - cup[1]);
    if (dc < 0.075){
      if (sp < 1.35){ holed = true; x = cup[0]; y = cup[1]; track.push([x, y]); break; }
      if (!lip){ lip = true; vx *= 0.6; vy *= 0.6; const t = Math.random() < 0.5 ? 0.35 : -0.35; const c = Math.cos(t), sn = Math.sin(t); [vx, vy] = [vx*c - vy*sn, vx*sn + vy*c]; }
    }
    lie = course.lie(x, y);
    if (lie === 'water' || lie === 'ob' || lie === 'bunker') break;
  }
  track.push([x, y]);
  return {track, rest: [x, y], lie: holed ? 'green' : lie, holed, lip};
}

// Walk back along a flight to the last dry point (for water drops).
function dropPoint(course, samples, from){
  for (let i = samples.length - 1; i >= 0; i--){ const p = samples[i]; const l = course.lie(p[0], p[1]); if (l !== 'water' && l !== 'ob') return [p[0], p[1]]; }
  return from.slice();
}

window.GolfPhysics = {CLUBS, ORDER, LIE_NAME, lieFactor, fullShot, putt, dropPoint};
})();
