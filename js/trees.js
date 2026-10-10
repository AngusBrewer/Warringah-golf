// Real-scale trees for a Sydney parkland course: tall eucalypts, round broadleaf trees,
// Norfolk Island pines and the odd palm. Each kind is one merged mesh drawn with instancing.
(function(){
'use strict';
const {rng} = window.GolfGeo;

// glue several non-indexed geometries (each with a flat colour) into one
function merge(parts){
  parts = parts.map(p => { const g = p.g.index ? p.g.toNonIndexed() : p.g; g.userData.keepNormals = p.g.userData.keepNormals; return Object.assign({}, p, {g}); });
  let n = 0; for (const p of parts) n += p.g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0; const c = new THREE.Color();
  for (const p of parts){
    const g = p.g; if (!g.userData.keepNormals) g.computeVertexNormals();
    const P = g.attributes.position.array, N = g.attributes.normal.array, k = P.length / 3;
    pos.set(P, o * 3); nor.set(N, o * 3);
    for (let i = 0; i < k; i++){ c.set(p.c); if (p.shade){ const s = p.shade(P[i*3], P[i*3+1], P[i*3+2]); c.multiplyScalar(s); } col[(o+i)*3] = c.r; col[(o+i)*3+1] = c.g; col[(o+i)*3+2] = c.b; }
    o += k;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
// lumpy leaf clump
function clump(r, x, y, z, sy, seed){
  const g = new THREE.IcosahedronGeometry(r, 1), p = g.attributes.position, R = rng(seed);
  const nor = new Float32Array(p.count * 3), seen = new Map();
  for (let i = 0; i < p.count; i++){
    const key = p.getX(i).toFixed(4) + ',' + p.getY(i).toFixed(4) + ',' + p.getZ(i).toFixed(4);
    if (!seen.has(key)) seen.set(key, 0.78 + R() * 0.38);            // same jitter for shared corners, so no cracks
    const f = seen.get(key), nx = p.getX(i), ny = p.getY(i), nz = p.getZ(i), l = Math.hypot(nx, ny, nz) || 1;
    nor[i*3] = nx / l; nor[i*3+1] = ny / l; nor[i*3+2] = nz / l;
    p.setXYZ(i, nx * f, ny * f * sy, nz * f);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.userData.keepNormals = true;
  g.translate(x, y, z); return g;
}
function trunk(h, r0, r1, lean = 0, x = 0, z = 0){
  const g = new THREE.CylinderGeometry(r1, r0, h, 7, 2); g.translate(0, h / 2, 0);
  if (lean){ const p = g.attributes.position; for (let i = 0; i < p.count; i++){ const t = p.getY(i) / h; p.setX(i, p.getX(i) + x * t * t); p.setZ(i, p.getZ(i) + z * t * t); } }
  return g;
}
const darker = (lo, hi) => (x, y) => lo + (hi - lo) * Math.min(1, Math.max(0, y));   // shade by height (unit tree)

// Every kind is built 1 unit tall; instances scale it to real metres.
function eucalypt(seed){
  const R = rng(seed), parts = [];
  parts.push({g: trunk(0.62, 0.02, 0.009, 1, 0.04, -0.03), c: '#d9d2c3'});          // pale gum bark
  parts.push({g: trunk(0.25, 0.012, 0.006).translate(0, 0.42, 0).rotateZ(0.35), c: '#cfc6b4'});
  for (let i = 0; i < 6; i++){ const a = R() * Math.PI * 2, d = 0.05 + R() * 0.14;
    parts.push({g: clump(0.09 + R() * 0.07, Math.cos(a) * d, 0.62 + R() * 0.3, Math.sin(a) * d, 0.75, seed + i), c: ['#5f7a4a','#6b8452','#56703f'][i % 3], shade: (x, y) => 0.75 + 0.35 * (y - 0.55)}); }
  return merge(parts);
}
function broadleaf(seed){
  const R = rng(seed), parts = [{g: trunk(0.42, 0.05, 0.03), c: '#6b5843'}];
  for (let i = 0; i < 5; i++){ const a = R() * Math.PI * 2, d = R() * 0.16;
    parts.push({g: clump(0.2 + R() * 0.08, Math.cos(a) * d, 0.58 + R() * 0.18, Math.sin(a) * d, 0.8, seed + i), c: ['#2f5b2a','#37662f','#2a5226'][i % 3], shade: (x, y) => 0.7 + 0.45 * (y - 0.4)}); }
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
function weeping(seed){         // paperbark / willow-ish, drooping
  const R = rng(seed), parts = [{g: trunk(0.5, 0.04, 0.025), c: '#bdb3a0'}];
  for (let i = 0; i < 6; i++){ const a = R() * Math.PI * 2, d = 0.08 + R() * 0.14;
    parts.push({g: clump(0.15, Math.cos(a) * d, 0.48 + R() * 0.2, Math.sin(a) * d, 1.35, seed + i), c: ['#6f8a4e','#7a9457'][i % 2], shade: (x, y) => 0.75 + 0.3 * y}); }
  return merge(parts);
}

// kinds: size ranges in metres; crown = fraction of height where leaves start; spread = crown radius / height
const KINDS = {
  euc:   {make: eucalypt,  h: [16, 26], crown: 0.5,  spread: 0.27, share: 0.42},
  broad: {make: broadleaf, h: [9, 14],  crown: 0.35, spread: 0.36, share: 0.3},
  pine:  {make: pine,      h: [20, 30], crown: 0.2,  spread: 0.2,  share: 0.1},
  palm:  {make: palm,      h: [8, 13],  crown: 0.8,  spread: 0.32, share: 0.06},
  weep:  {make: weeping,   h: [8, 12],  crown: 0.35, spread: 0.42, share: 0.12}
};
function pickKind(r){ let a = 0; for (const k in KINDS){ a += KINDS[k].share; if (r < a) return k; } return 'euc'; }

// give every tree a kind and real dimensions (used for both drawing and ball collisions)
function dress(trees){
  const R = rng(4242);
  for (const t of trees){
    const k = t.kind = pickKind(R()), K = KINDS[k];
    t.h = K.h[0] + R() * (K.h[1] - K.h[0]);
    t.r = t.h * K.spread * (0.85 + R() * 0.3);      // crown radius
    t.base = t.h * K.crown;                          // height where the crown starts
    t.rot = R() * Math.PI * 2; t.v = R();
  }
  return trees;
}
function build(scene, trees, ground){
  ground = ground || (() => 0);
  const mat = new THREE.MeshLambertMaterial({vertexColors: true, side: THREE.DoubleSide});
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  for (const k in KINDS){
    const list = trees.filter(t => t.kind === k); if (!list.length) continue;
    // three shape variants per kind so neighbours don't look cloned
    for (let v = 0; v < 3; v++){
      const sub = list.filter((t, i) => i % 3 === v); if (!sub.length) continue;
      const mesh = new THREE.InstancedMesh(KINDS[k].make(100 + v * 17 + k.length), mat, sub.length);
      sub.forEach((t, i) => { q.setFromAxisAngle(up, t.rot); const w = t.r / (t.h * KINDS[k].spread);
        m.compose(window.GolfW(t.x, t.y, ground(t.x, t.y) - 0.3), q, s.set(t.h * w, t.h, t.h * w)); mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, col.setHSL(0, 0, 0.88 + t.v * 0.22)); });
      scene.add(mesh);
    }
  }
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
