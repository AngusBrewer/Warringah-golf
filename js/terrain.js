// Real ground heights from Geoscience Australia's LiDAR 5 m elevation model.
// A 10 m grid covers the whole course; each green also has its own 5 m grid (every LiDAR cell) for putting.
(function(){
'use strict';
class Grid {
  constructor(g){ this.x0 = g.x0; this.y0 = g.y0; this.step = g.step; this.nx = g.nx; this.ny = g.ny; this.h = g.h.map(v => v / 100); }   // stored in cm
  inside(x, y){ return x >= this.x0 && y >= this.y0 && x <= this.x0 + (this.nx - 1) * this.step && y <= this.y0 + (this.ny - 1) * this.step; }
  at(x, y){
    const fx = Math.max(0, Math.min(this.nx - 1.001, (x - this.x0) / this.step)), fy = Math.max(0, Math.min(this.ny - 1.001, (y - this.y0) / this.step));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, H = this.h, n = this.nx;
    const a = H[j*n + i], b = H[j*n + i + 1], c = H[(j+1)*n + i], d = H[(j+1)*n + i + 1];
    return a*(1-u)*(1-v) + b*u*(1-v) + c*(1-u)*v + d*u*v;
  }
}
class Terrain {
  constructor(data){
    this.base = new Grid(data.course);
    this.fine = (data.greens || []).map(g => new Grid(g));
    this.lo = Math.min(...this.base.h);           // lowest point sits at height 0 in the 3D world
  }
  height(x, y){
    for (const g of this.fine){
      if (!g.inside(x, y)) continue;
      // blend the detailed green grid into the coarse one over its outer 4 m
      const ex = Math.min(x - g.x0, g.x0 + (g.nx-1)*g.step - x), ey = Math.min(y - g.y0, g.y0 + (g.ny-1)*g.step - y);
      const w = Math.max(0, Math.min(1, Math.min(ex, ey) / 4));
      return (g.at(x, y) * w + this.base.at(x, y) * (1 - w)) - this.lo;
    }
    return this.base.at(x, y) - this.lo;
  }
  grad(x, y){ const d = 1; return [(this.height(x + d, y) - this.height(x - d, y)) / (2*d), (this.height(x, y + d) - this.height(x, y - d)) / (2*d)]; }
}
// flat stand-in when no elevation data is loaded
const Flat = {height: () => 0, grad: () => [0, 0]};
window.GolfTerrain = {Terrain, Flat};
})();
