// Real-scale trees for a Sydney parkland course: tall eucalypts, round broadleaf trees,
// Norfolk Island pines and the odd palm. Each kind is one merged mesh drawn with instancing.
(function(){
'use strict';
const {rng} = window.GolfGeo;

// glue several non-indexed geometries (each with a flat colour) into one
function merge(parts){
  if (LO) parts = parts.filter((p, i) => !p.g.userData.keepNormals || i % 2 === 0);
  parts = parts.map(p => { const g = p.g.index ? p.g.toNonIndexed() : p.g; g.userData.keepNormals = p.g.userData.keepNormals; return Object.assign({}, p, {g}); });
  let n = 0; for (const p of parts) n += p.g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2).fill(0.02);
  // leaf clumps carry texture coordinates into the leaf texture; everything else samples its solid corner
  let o = 0; const c = new THREE.Color();
  for (const p of parts){
    const g = p.g; if (!g.userData.keepNormals) g.computeVertexNormals();
    const P = g.attributes.position.array, N = g.attributes.normal.array, k = P.length / 3;
    pos.set(P, o * 3); nor.set(N, o * 3);
    if (g.userData.leafy && !LO) uv.set(g.attributes.uv.array, o * 2); else for (let i = 0; i < k; i++) uv[(o+i)*2+1] = 0.98;
    for (let i = 0; i < k; i++){ c.set(p.c); if (p.shade){ const s = p.shade(P[i*3], P[i*3+1], P[i*3+2]); c.multiplyScalar(s); } col[(o+i)*3] = c.r; col[(o+i)*3+1] = c.g; col[(o+i)*3+2] = c.b; }
    o += k;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
// lumpy leaf clump. Normals point out from the whole crown's centre (cx, cy, cz), so a crown
// made of many clumps is lit like one soft, rounded mass, the way real canopies look.
// LO: building the far-away version (fewer, coarser clumps)
let LO = false;
function clump(r, x, y, z, sy, seed, ctr){
  if (LO) r *= 1.3;
  const g = new THREE.IcosahedronGeometry(r, LO ? 0 : 1), p = g.attributes.position, R = rng(seed);
  const nor = new Float32Array(p.count * 3), uvs = new Float32Array(p.count * 2), seen = new Map();
  for (let i = 0; i < p.count; i++){
    const key = p.getX(i).toFixed(4) + ',' + p.getY(i).toFixed(4) + ',' + p.getZ(i).toFixed(4);
    if (!seen.has(key)) seen.set(key, 0.72 + R() * 0.5);            // same jitter for shared corners, so no cracks
    const f = seen.get(key), lx = p.getX(i), ly = p.getY(i), lz = p.getZ(i);
    const px = lx * f + x, py = ly * f * sy + y, pz = lz * f + z;
    let nx = lx, ny = ly, nz = lz;
    if (ctr){ const ox = px - ctr[0], oy = (py - ctr[1]) * 1.3, oz = pz - ctr[2], ol = Math.hypot(ox, oy, oz) || 1, ll = Math.hypot(lx, ly, lz) || 1;
      nx = 0.82 * ox / ol + 0.18 * lx / ll; ny = 0.82 * oy / ol + 0.18 * ly / ll; nz = 0.82 * oz / ol + 0.18 * lz / ll; }
    const l = Math.hypot(nx, ny, nz) || 1; nor[i*3] = nx / l; nor[i*3+1] = ny / l; nor[i*3+2] = nz / l;
    p.setXYZ(i, px, py, pz);
    // wrap the leaf texture round the clump (two repeats around, one and a half top to bottom)
    const ll = Math.hypot(lx, ly, lz) || 1; uvs[i*2] = (Math.atan2(lz, lx) / (2 * Math.PI) + 0.5) * 2 + R() * 0.0; uvs[i*2+1] = (Math.asin(ly / ll) / Math.PI + 0.5) * 1.5 + (seed % 7) * 0.13;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.userData.keepNormals = true; g.userData.leafy = true;
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return g;
}
function trunk(h, r0, r1, lean = 0, x = 0, z = 0){
  const g = new THREE.CylinderGeometry(r1, r0, h, 7, 3); g.translate(0, h / 2, 0);
  if (lean){ const p = g.attributes.position; for (let i = 0; i < p.count; i++){ const t = p.getY(i) / h; p.setX(i, p.getX(i) + x * t * t); p.setZ(i, p.getZ(i) + z * t * t); } }
  return g;
}
function limb(x0, y0, z0, x1, y1, z1, r){         // a branch from one point to another
  const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0), g = new THREE.CylinderGeometry(r * 0.6, r, L, 5, 1);
  g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize());
  g.applyQuaternion(q); g.translate(x0, y0, z0); return g;
}
// leaf colour varies through the crown: darker underneath and inside, lighter on top
const leafShade = (lo, hi, base) => (x, y, z) => { const n = Math.sin(x * 37.1 + z * 21.7 + y * 13.3) * 0.5 + 0.5; return (lo + (hi - lo) * Math.min(1, Math.max(0, (y - base) / (1 - base)))) * (0.9 + n * 0.2); };

// Every kind is built 1 unit tall and about 1 unit across at the crown; instances scale it to real metres.
// Shapes and colours follow photos of the course: broad, dark olive gums lining the fairways, dense
// dark figs and brush box, wispy grey-green she-oaks and pale paperbarks.
function gum(seed){                     // eucalypt: pale trunk that forks, broad irregular olive crown
  const R = rng(seed), parts = [], cols = ['#6e7f4c', '#637446', '#788857', '#5a6a40'];
  parts.push({g: trunk(0.42, 0.035, 0.022, 1, 0.03, -0.02), c: '#bfb7a5'});
  const forks = [];
  for (let i = 0; i < 3; i++){ const a = i / 3 * Math.PI * 2 + R() * 0.8, d = 0.16 + R() * 0.12, tx = 0.03 + Math.cos(a) * d, tz = -0.02 + Math.sin(a) * d, ty = 0.6 + R() * 0.12;
    parts.push({g: limb(0.03, 0.4, -0.02, tx, ty, tz, 0.016), c: '#b9b19f'}); forks.push([tx, ty, tz]); }
  const ctr = [0.03, 0.7, -0.02];
  for (let i = 0; i < 11; i++){ const f = forks[i % 3], a = R() * Math.PI * 2, d = R() * 0.17;
    parts.push({g: clump(0.12 + R() * 0.1, f[0] + Math.cos(a) * d, f[1] + 0.02 + R() * 0.22, f[2] + Math.sin(a) * d, 0.7, seed * 31 + i, ctr), c: cols[i % 4], shade: leafShade(0.68, 1.12, 0.45)}); }
  return merge(parts);
}
function fig(seed){                     // fig / brush box: short thick trunk, dense dark dome
  const R = rng(seed), parts = [{g: trunk(0.36, 0.06, 0.04), c: '#665645'}], cols = ['#3b5a30', '#446437', '#35522b'];
  const ctr = [0, 0.62, 0];
  for (let i = 0; i < 10; i++){ const a = R() * Math.PI * 2, d = Math.sqrt(R()) * 0.32;
    parts.push({g: clump(0.18 + R() * 0.08, Math.cos(a) * d, 0.5 + R() * 0.3 - d * 0.2, Math.sin(a) * d, 0.75, seed * 17 + i, ctr), c: cols[i % 3], shade: leafShade(0.62, 1.15, 0.35)}); }
  return merge(parts);
}
function sheoak(seed){                  // casuarina: grey-green, wispy, drooping, taller than wide
  const R = rng(seed), parts = [{g: trunk(0.75, 0.025, 0.01, 1, 0.02, 0.01), c: '#5b4e42'}], cols = ['#5e6a50', '#677357', '#56624a'];
  const ctr = [0.01, 0.6, 0];
  for (let i = 0; i < 10; i++){ const y = 0.28 + R() * 0.68, w = 0.3 * Math.sin(Math.PI * Math.min(1, (y - 0.2) / 0.8)) + 0.05, a = R() * Math.PI * 2, d = R() * w;
    parts.push({g: clump(0.07 + R() * 0.06, Math.cos(a) * d, y, Math.sin(a) * d, 1.6, seed * 13 + i, ctr), c: cols[i % 3], shade: leafShade(0.75, 1.08, 0.2)}); }
  return merge(parts);
}
function paperbark(seed){               // melaleuca: papery white trunk, light olive crown
  const R = rng(seed), parts = [{g: trunk(0.5, 0.045, 0.028, 1, -0.03, 0.02), c: '#e0d9c9'}], cols = ['#788a57', '#829461', '#6e8050'];
  const ctr = [-0.03, 0.66, 0.02];
  for (let i = 0; i < 9; i++){ const a = R() * Math.PI * 2, d = Math.sqrt(R()) * 0.26;
    parts.push({g: clump(0.12 + R() * 0.06, -0.03 + Math.cos(a) * d, 0.5 + R() * 0.32, 0.02 + Math.sin(a) * d, 1.05, seed * 7 + i, ctr), c: cols[i % 3], shade: leafShade(0.7, 1.1, 0.4)}); }
  return merge(parts);
}
function pine(seed){            // Norfolk Island pine: tall, tiered, symmetrical
  const parts = [{g: trunk(1, 0.025, 0.006), c: '#5e4b3a'}];
  for (let i = 0; i < 9; i++){ const y = 0.22 + i * 0.085, r = 0.2 * (1 - i / 10) + 0.02;
    const g = new THREE.ConeGeometry(r, 0.1, 9, 1, true); g.translate(0, y, 0); parts.push({g, c: i % 2 ? '#284a2c' : '#2e5533'}); }
  return merge(parts);
}
function palm(seed){
  const R = rng(seed), parts = [{g: trunk(0.86, 0.022, 0.016, 1, 0.06, 0.02), c: '#8a7a62'}];
  for (let i = 0; i < 9; i++){ const a = i / 9 * Math.PI * 2 + R() * 0.3;
    const g = new THREE.PlaneGeometry(0.34, 0.06, 4, 1); const p = g.attributes.position;
    for (let k = 0; k < p.count; k++){ const x = p.getX(k) + 0.17; p.setXYZ(k, x, p.getY(k) * (1 - x / 0.4), -x * x * 1.4); }
    g.rotateX(-Math.PI / 2 + 0.25); g.rotateY(a); g.translate(0.06, 0.86, 0.02); parts.push({g, c: i % 2 ? '#4f7a33' : '#5d8a3b'}); }
  return merge(parts);
}

// kinds: crown = fraction of height where leaves start; spread = crown radius / height (of the unit model);
// hr = height from the crown radius traced off the aerial photo
const KINDS = {
  gum:   {make: gum,       crown: 0.42, spread: 0.36, hr: [2.0, 2.8], share: 0.45},
  fig:   {make: fig,       crown: 0.3,  spread: 0.46, hr: [1.5, 1.9], share: 0.2},
  oak:   {make: sheoak,    crown: 0.25, spread: 0.3,  hr: [2.4, 3.2], share: 0.16},
  bark:  {make: paperbark, crown: 0.38, spread: 0.36, hr: [1.8, 2.3], share: 0.13},
  pine:  {make: pine,      crown: 0.2,  spread: 0.2,  hr: [3.5, 4.5], share: 0.03},
  palm:  {make: palm,      crown: 0.8,  spread: 0.32, hr: [2.4, 3.0], share: 0.03}
};
function pickKind(r){ let a = 0; for (const k in KINDS){ a += KINDS[k].share; if (r < a) return k; } return 'gum'; }

// give every tree a kind and real dimensions (used for both drawing and ball collisions)
function dress(trees){
  const R = rng(4242);
  for (const t of trees){
    const k = t.kind = pickKind(R()), K = KINDS[k];
    if (!t.traced){ t.r = 3 + R() * 4; }
    const r = k === 'pine' || k === 'palm' ? Math.min(t.r, 4) : t.r;     // narrow kinds don't fill a wide canopy patch
    t.h = Math.min(30, Math.max(7, r * (K.hr[0] + R() * (K.hr[1] - K.hr[0])) + 2));
    t.r = r * (0.95 + R() * 0.2);                     // crown radius
    t.base = t.h * K.crown;                           // height where the crown starts
    t.rot = R() * Math.PI * 2; t.v = R();
  }
  return trees;
}
// Leaves: a tile of small leaf shapes on a transparent background, in shades of grey so each tree's
// own colour tints it. Cut out with alphaTest, a crown gets a ragged, see-through edge instead of a
// faceted blob. The top-left corner is solid white for trunks and branches.
function leafTexture(){
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'), R = rng(311);
  for (let i = 0; i < 2600; i++){
    const x = R() * S, y = R() * S, a = R() * Math.PI, l = 3 + R() * 6, w = 1.3 + R() * 2.2, v = Math.round(150 + R() * 105);
    g.fillStyle = `rgb(${v},${v},${v})`;
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]){ g.beginPath(); g.ellipse(x + dx, y + dy, l, w, a, 0, Math.PI * 2); g.fill(); }
  }
  g.fillStyle = '#fff'; g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
  return t;
}
// Trees are grouped into 200 m tiles. Near the camera a tile uses the detailed trees; further away
// a coarse version, so thousands of trees stay cheap to draw. Call update(camera position) each frame.
function build(scene, trees, ground){
  ground = ground || (() => 0);
  const mat = new THREE.MeshLambertMaterial({vertexColors: true, side: THREE.DoubleSide, map: leafTexture(), alphaTest: 0.5});
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const V = 3, TILE = 200, geos = {};
  for (const k in KINDS) for (let v = 0; v < V; v++){ const seed = 100 + v * 17 + k.length;
    LO = false; const hi = KINDS[k].make(seed); LO = true; const lo = KINDS[k].make(seed); LO = false; geos[k + v] = {hi, lo}; }
  const tiles = new Map();
  trees.forEach((t, i) => { const key = Math.floor(t.x / TILE) + ',' + Math.floor(t.y / TILE); if (!tiles.has(key)) tiles.set(key, []); tiles.get(key).push(t); });
  const out = [];
  for (const [key, list] of tiles){
    const [tx, ty] = key.split(',').map(Number), tile = {cx: (tx + 0.5) * TILE, cy: (ty + 0.5) * TILE, hi: [], lo: []};
    for (const k in KINDS) for (let v = 0; v < V; v++){
      const sub = list.filter(t => t.kind === k && Math.floor(t.v * V) === v); if (!sub.length) continue;
      for (const lod of ['hi', 'lo']){
        // share the vertex data, but give each tile its own bounds so off-screen tiles are skipped
        const base = geos[k + v][lod], g = new THREE.BufferGeometry();
        for (const name in base.attributes) g.setAttribute(name, base.attributes[name]);
        g.boundingSphere = new THREE.Sphere(window.GolfW(tile.cx, tile.cy, 10), TILE * 0.72 + 25);
        const mesh = new THREE.InstancedMesh(g, mat, sub.length);
        sub.forEach((t, i) => { q.setFromAxisAngle(up, t.rot); const w = t.r / (t.h * KINDS[k].spread);
          m.compose(window.GolfW(t.x, t.y, ground(t.x, t.y) - 0.3), q, s.set(t.h * w, t.h, t.h * w)); mesh.setMatrixAt(i, m);
          mesh.setColorAt(i, col.setHSL(0.08 * (t.rot / 6.28 - 0.5), 0.1 * t.v, 0.86 + ((t.rot * 7) % 1) * 0.2)); });
        mesh.visible = lod === 'lo';
        scene.add(mesh); tile[lod].push(mesh);
      }
    }
    out.push(tile);
  }
  let last = '';
  return {update(cam){   // cam: three.js position (x = east, z = south)
    const cx = cam.x, cy = -cam.z, key = Math.round(cx / 20) + ',' + Math.round(cy / 20); if (key === last) return; last = key;
    for (const t of out){ const near = Math.hypot(t.cx - cx, t.cy - cy) < 230; for (const mm of t.hi) mm.visible = near; for (const mm of t.lo) mm.visible = !near; }
  }};
}
// does a ball at (x, y, z) hit this tree?
function hits(t, x, y, z){
  const d = Math.hypot(x - t.x, y - t.y);
  if (z > t.h) return false;
  if (z >= t.base){ if (d < t.r * 0.45) return 'inner';               // the thick of the crown always stops it
    return d < t.r * 0.8 ? 'outer' : false; }                          // the outer leaves only sometimes
  return d < 0.45 ? 'inner' : false;                 // the trunk
}
window.GolfTrees = {dress, build, hits};
})();
