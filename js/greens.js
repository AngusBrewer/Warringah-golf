// Putting greens: a gentle, seeded slope surface per green, the 3D green mesh with mowing
// stripes, and the Wii-style "read the green" grid (colour = steepness, arrows = downhill).
(function(){
'use strict';
const {pip, edgeDist, bbox, centroid, rng} = window.GolfGeo;

class GreenField {
  // base(x, y) is the real ground height (LiDAR); the green adds a few centimetres of crown on top
  constructor(poly, seed, base){
    this.poly = poly; this.b = bbox(poly); this.c = centroid(poly); this.base = base || (() => 0);
    const R = rng(seed);
    this.stripe = R() * Math.PI;
    const w = (this.b[2] - this.b[0]), hgt = (this.b[3] - this.b[1]);
    this.humps = [];
    const n = 1 + Math.floor(R() * 2);
    for (let i = 0; i < n; i++) this.humps.push({x: this.b[0] + w * (0.25 + R() * 0.5), y: this.b[1] + hgt * (0.25 + R() * 0.5), amp: 0.03 + R() * 0.05, sig: 3 + R() * 3});
  }
  micro(x, y){ let h = 0; for (const k of this.humps) h += k.amp * Math.exp(-((x - k.x) ** 2 + (y - k.y) ** 2) / (2 * k.sig * k.sig)); return h; }
  height(x, y){
    const inside = pip(x, y, this.poly), e = edgeDist(x, y, this.poly);
    const blend = inside ? Math.min(1, 0.4 + e / 3) : Math.max(0, 0.4 - e / 3);
    return this.base(x, y) + (this.micro(x, y) + 0.02) * blend;
  }
  grad(x, y){ const d = 0.25; return [(this.height(x + d, y) - this.height(x - d, y)) / (2 * d), (this.height(x, y + d) - this.height(x, y - d)) / (2 * d)]; }
}

// rolling ball pull from the slope (m/s²), pointing downhill
function slopeAccel(field, x, y){ const g = field.grad(x, y); return [-9.81 * g[0] * 0.55, -9.81 * g[1] * 0.55]; }

function greenMesh(field, W){
  const b = field.b, pad = 1.5, step = 0.5;
  const nx = Math.ceil((b[2] - b[0] + 2*pad) / step), ny = Math.ceil((b[3] - b[1] + 2*pad) / step);
  const pos = [], col = [], uv = [], c = new THREE.Color();
  const light = new THREE.Color('#8fdc5c'), dark = new THREE.Color('#7fcc4f'), fringe = new THREE.Color('#6cb846');
  // stripe direction across the green
  const sx = Math.cos(field.stripe), sy = Math.sin(field.stripe);
  const vert = (x, y) => {
    const inside = pip(x, y, field.poly);
    c.copy(inside ? ((Math.floor((x * sx + y * sy) / 2.4) % 2 === 0) ? light : dark) : fringe);
    const h = field.height(x, y); const p = W(x, y, h + 0.012);
    pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); uv.push((x - b[0] + pad) / (nx * step), (y - b[1] + pad) / (ny * step));
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++){
    const x0 = b[0] - pad + i * step, y0 = b[1] - pad + j * step, x1 = x0 + step, y1 = y0 + step, cx = x0 + step/2, cy = y0 + step/2;
    if (!pip(cx, cy, field.poly) && edgeDist(cx, cy, field.poly) > 1.2) continue;
    vert(x0, y0); vert(x1, y0); vert(x1, y1);
    vert(x0, y0); vert(x1, y1); vert(x0, y1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({vertexColors: true}));
  mesh.userData.size = [nx * step, ny * step]; mesh.userData.origin = [b[0] - pad, b[1] - pad];
  return mesh;
}

// Wii-style read: a grid that follows the contours, tinted by steepness, with downhill arrows
function readTexture(field, size, origin){
  const S = 24, cv = document.createElement('canvas'); cv.width = Math.min(2048, Math.ceil(size[0] * S)); cv.height = Math.min(2048, Math.ceil(size[1] * S));
  const g = cv.getContext('2d'), sx = cv.width / size[0], sy = cv.height / size[1];
  const toPx = (x, y) => [(x - origin[0]) * sx, cv.height - (y - origin[1]) * sy];
  const colour = s => { const t = Math.min(1, s / 0.03); const hue = 220 - 220 * t; return `hsla(${hue}, 90%, 55%, 0.42)`; };
  for (let x = origin[0]; x < origin[0] + size[0]; x += 1) for (let y = origin[1]; y < origin[1] + size[1]; y += 1){
    if (!pip(x + .5, y + .5, field.poly)) continue;
    const gr = field.grad(x + .5, y + .5), s = Math.hypot(gr[0], gr[1]); const [px, py] = toPx(x, y + 1);
    g.fillStyle = colour(s); g.fillRect(px, py, sx, sy);
  }
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.2;
  for (let x = Math.ceil(origin[0]); x < origin[0] + size[0]; x += 1){ const [px] = toPx(x, 0); g.beginPath(); g.moveTo(px, 0); g.lineTo(px, cv.height); g.stroke(); }
  for (let y = Math.ceil(origin[1]); y < origin[1] + size[1]; y += 1){ const [, py] = toPx(0, y); g.beginPath(); g.moveTo(0, py); g.lineTo(cv.width, py); g.stroke(); }
  // arrows every 2 m pointing downhill, longer where it's steeper
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.fillStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2;
  for (let x = Math.ceil(origin[0]); x < origin[0] + size[0]; x += 2) for (let y = Math.ceil(origin[1]); y < origin[1] + size[1]; y += 2){
    if (!pip(x, y, field.poly)) continue;
    const gr = field.grad(x, y), s = Math.hypot(gr[0], gr[1]); if (s < 0.002) continue;
    const L = Math.min(0.9, 0.25 + s * 25), dx = -gr[0] / s * L, dy = -gr[1] / s * L;
    const [ax, ay] = toPx(x - dx/2, y - dy/2), [bx, by] = toPx(x + dx/2, y + dy/2);
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    const ang = Math.atan2(by - ay, bx - ax); g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - 7*Math.cos(ang - .5), by - 7*Math.sin(ang - .5)); g.lineTo(bx - 7*Math.cos(ang + .5), by - 7*Math.sin(ang + .5)); g.closePath(); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding; return tex;
}

window.GolfGreens = {GreenField, slopeAccel, greenMesh, readTexture};
})();
