// Course geometry helpers: what's under the ball, distances, tree lookups.
// Coordinates are metres: x east, y north.
(function(){
'use strict';

function pip(x, y, a){            // point in polygon (flat [x0,y0,x1,y1,...])
  let inside = false;
  for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2){
    const xi = a[i], yi = a[i+1], xj = a[j], yj = a[j+1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function segDist(px, py, ax, ay, bx, by){
  const dx = bx - ax, dy = by - ay, L = dx*dx + dy*dy;
  let t = L ? ((px - ax)*dx + (py - ay)*dy) / L : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t*dx, py - ay - t*dy);
}
function edgeDist(x, y, a){       // distance to a polygon's outline
  let m = Infinity;
  for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) m = Math.min(m, segDist(x, y, a[j], a[j+1], a[i], a[i+1]));
  return m;
}
function lineDist(x, y, a){       // distance to a polyline
  let m = Infinity;
  for (let i = 2; i < a.length; i += 2) m = Math.min(m, segDist(x, y, a[i-2], a[i-1], a[i], a[i+1]));
  return m;
}
function bbox(a){ let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < a.length; i += 2){ x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]); y0 = Math.min(y0, a[i+1]); y1 = Math.max(y1, a[i+1]); }
  return [x0, y0, x1, y1]; }
function centroid(a){ let x = 0, y = 0; for (let i = 0; i < a.length; i += 2){ x += a[i]; y += a[i+1]; } return [x / (a.length/2), y / (a.length/2)]; }

// Small seeded random so a hole's pin, wind and trees are the same every time you play it.
function rng(seed){ let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

class Course {
  constructor(data){
    this.d = data;
    const mk = list => (list || []).map(a => ({a, b: bbox(a)}));
    this.greens = mk(data.greens); this.tees = mk(data.tees); this.fairways = mk(data.fairways);
    this.bunkers = mk(data.bunkers); this.water = mk(data.water); this.bounds = mk(data.bounds);
    this.creeks = (data.creeks || []).map(a => ({a, b: bbox(a)}));
    this.extent = this.bounds.reduce((e, p) => [Math.min(e[0], p.b[0]), Math.min(e[1], p.b[1]), Math.max(e[2], p.b[2]), Math.max(e[3], p.b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    this.trees = this.buildTrees(); if (window.GolfTrees) GolfTrees.dress(this.trees);
    this.grid = new Map();
    for (const t of this.trees){ const k = this.key(t.x, t.y); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(t); }
  }
  key(x, y){ return Math.floor(x / 20) + ',' + Math.floor(y / 20); }
  hit(list, x, y, pad = 0){ for (const p of list){ const b = p.b; if (x < b[0]-pad || x > b[2]+pad || y < b[1]-pad || y > b[3]+pad) continue; if (pip(x, y, p.a)) return p; } return null; }
  inBounds(x, y){ return !!this.hit(this.bounds, x, y); }
  inWater(x, y){
    if (this.hit(this.water, x, y)) return true;
    for (const c of this.creeks){ const b = c.b; if (x < b[0]-4 || x > b[2]+4 || y < b[1]-4 || y > b[3]+4) continue; if (lineDist(x, y, c.a) < 2.6) return true; }
    return false;
  }
  greenAt(x, y){ return this.hit(this.greens, x, y); }
  // Stricter out of bounds (version 15): as well as leaving the property, a ball that finishes well away
  // from the hole being played is out, unless it is on (or right by) a fairway, green or tee.
  // Corridor: 30 m either side of the line of play on a par 3, 40 m on longer holes, 45 m round the green.
  inPlay(x, y, hole){
    if (!this.inBounds(x, y)) return false;
    if (!hole) return true;
    const w = hole.par <= 3 ? 30 : 40, p = hole.path;
    for (let i = 0; i < p.length - 1; i++) if (segDist(x, y, p[i][0], p[i][1], p[i+1][0], p[i+1][1]) < w) return true;
    const e = p[p.length - 1]; if (Math.hypot(x - e[0], y - e[1]) < 45) return true;   // over the back of the green: a bit more room
    if (this.hit(this.fairways, x, y, 0) || this.hit(this.greens, x, y, 0) || this.hit(this.tees, x, y, 0)) return true;
    for (const L of [this.fairways, this.greens]) for (const f of L){ const b = f.b; if (x < b[0]-6 || x > b[2]+6 || y < b[1]-6 || y > b[3]+6) continue; if (edgeDist(x, y, f.a) < 5) return true; }
    return false;
  }
  lie(x, y){
    if (!this.inBounds(x, y)) return 'ob';
    if (this.inWater(x, y)) return 'water';
    if (this.hit(this.bunkers, x, y)) return 'bunker';
    if (this.hit(this.greens, x, y)) return 'green';
    for (const g of this.greens){ const b = g.b; if (x < b[0]-2 || x > b[2]+2 || y < b[1]-2 || y > b[3]+2) continue; if (edgeDist(x, y, g.a) < 1.8) return 'fringe'; }
    if (this.hit(this.tees, x, y)) return 'tee';
    if (this.hit(this.fairways, x, y)) return 'fairway';
    return 'rough';
  }
  treesNear(x, y){ const out = []; const cx = Math.floor(x / 20), cy = Math.floor(y / 20);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++){ const l = this.grid.get((cx+i) + ',' + (cy+j)); if (l) out.push(...l); } return out; }

  buildTrees(){
    const d = this.d, out = [], r = rng(20261010);
    const add = (x, y, s) => { if (!this.inBounds(x, y) && s !== 'edge') return;
      if (this.hit(this.greens, x, y, 3) || this.hit(this.tees, x, y, 2) || this.hit(this.bunkers, x, y, 1) || this.hit(this.fairways, x, y, -2) || this.inWater(x, y)) return;
      out.push({x, y, r: 4, h: 15, base: 7}); };   // real kinds and sizes are set by GolfTrees.dress
    // traced from aerial imagery: [x, y, crown radius, inside the course]
    if (d.canopy && d.canopy.length){ for (const t of d.canopy) out.push({x: t[0], y: t[1], r: t[2], h: 15, base: 7, traced: true, edge: !t[3]}); return out; }
    for (const t of d.trees || []) add(t[0], t[1]);
    for (const row of d.treeRows || []) for (let i = 2; i < row.length; i += 2){
      const ax = row[i-2], ay = row[i-1], bx = row[i], by = row[i+1], L = Math.hypot(bx-ax, by-ay);
      for (let s = 0; s < L; s += 7) add(ax + (bx-ax)*s/L + (r()-.5)*2, ay + (by-ay)*s/L + (r()-.5)*2);
    }
    for (const w of d.woods || []){ const b = bbox(w);
      for (let x = b[0]; x < b[2]; x += 8) for (let y = b[1]; y < b[3]; y += 8){ const px = x + r()*5, py = y + r()*5; if (pip(px, py, w)) add(px, py); } }
    // trees just outside the boundary frame the course
    for (const bd of d.bounds || []){ const c = centroid(bd);
      for (let i = 2; i < bd.length; i += 2){ const ax = bd[i-2], ay = bd[i-1], bx = bd[i], by = bd[i+1], L = Math.hypot(bx-ax, by-ay);
        for (let s = 0; s < L; s += 9){ let x = ax + (bx-ax)*s/L, y = ay + (by-ay)*s/L; const nx = -(by-ay)/L, ny = (bx-ax)/L;
          const o = (pip(x + nx*3, y + ny*3, bd) ? -1 : 1) * (5 + r()*8); add(x + nx*o, y + ny*o, 'edge'); } } }
    return out;
  }
}

window.GolfGeo = {pip, segDist, edgeDist, lineDist, bbox, centroid, rng, Course};
})();
