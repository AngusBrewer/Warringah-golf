// 3D view: course ground painted from the map, trees, flag, ball and the camera.
// three.js world: X = east, Z = south (so course y maps to -Z), Y = up.
(function(){
'use strict';
const {centroid, rng} = window.GolfGeo;
const W = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
// treat every colour we write as sRGB (as designed), so vertex-coloured trees and greens aren't washed out
THREE.ColorManagement.legacyMode = false;

const SUN = new THREE.Vector3(-0.42, 0.78, -0.47).normalize();   // three.js axes: -z is north
const PAL = {
  off: '#5d7244', offDots: '#54683c', rough: '#3e7a2b', roughDots: '#366d25',
  fairway: '#4e9234', fairStripe: '#58a03b', green: '#3d892c', fringe: '#387d29',
  tee: '#55983a', sand: '#e6d5a3', sandEdge: '#cdb987', water: '#3a7fb8', waterEdge: '#2b6593', ob: '#ffffff'
};

// fine grass grain on the ground so it doesn't look flat close up (world-space noise, no extra textures)
function grassDetail(mat, fine){
  mat.customProgramCacheKey = () => 'grass' + (fine ? 'fine' : '');
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWP;
float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{ float d = length(vWP - cameraPosition); float k = 1.0 - smoothstep(25.0, 140.0, d);
  float n = gn(vWP.xz * 1.7) * 0.55 + gn(vWP.xz * 6.0) * 0.3 + gn(vWP.xz * 0.35) * 0.6;
  diffuseColor.rgb *= mix(1.0, 0.86 + n * 0.17, k); diffuseColor.rgb *= 0.95 + gn(vWP.xz * 0.05) * 0.1;
  // right under your feet: a fine blade-scale grain, so the ground isn't a smooth photo up close
  float kc = 1.0 - smoothstep(4.0, 30.0, d);
  float bl = gn(vWP.xz * 15.0) * 0.5 + gn(vWP.xz * 41.0) * 0.5;
  diffuseColor.rgb *= mix(1.0, 0.8 + bl * 0.34, kc * ${fine ? '0.35' : '1.0'});
  ${fine ? `// close-cut putting surface: a fine, even grain like real bentgrass
  float kf = 1.0 - smoothstep(3.0, 30.0, d);
  float f2 = gn(vWP.xz * 31.0) * 0.55 + gn(vWP.xz * 11.0) * 0.45;
  diffuseColor.rgb *= mix(1.0, 0.9 + f2 * 0.16, kf);` : ''} }`);
  };
  return mat;
}

class GolfScene {
  constructor(canvas, course){
    this.course = course; this.terrain = course.terrain || GolfTerrain.Flat;
    const r = this.renderer = new THREE.WebGLRenderer({canvas, antialias: true});
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.78;   // softer, more photographic highlights
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color('#a9d8f5');
    s.fog = new THREE.Fog('#cfe6f2', 300, 1400);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.03, 4000);
    s.add(new THREE.HemisphereLight('#e2f0ff', '#5b7444', 0.62));
    // Sydney afternoon sun: high in the north-west, so shadows fall to the south-east
    const sun = new THREE.DirectionalLight('#fff1d6', 0.95); sun.position.copy(SUN).multiplyScalar(600); s.add(sun);
    this.buildSky();
    this.buildGround(); this.trees = GolfTrees.build(s, course.trees, (x, y) => this.terrain.height(x, y)); this.buildGreens(); this.buildFlag(); this.buildBall(); this.buildAim();
    this.golfer = new GolfGolfer(s);
    this.ballScale = 2;
    this.camPos = new THREE.Vector3(0, 50, 50); this.camLook = new THREE.Vector3();
    this.camGoalPos = this.camPos.clone(); this.camGoalLook = new THREE.Vector3();
    this.resize();
  }

  // ---------- ground ----------
  buildGround(){
    const c = this.course, d = c.d, [x0, y0, x1, y1] = c.extent, M = d.margin || 90;
    this.gx0 = x0 - M; this.gy0 = y0 - M; this.gw = (x1 - x0) + 2*M; this.gh = (y1 - y0) + 2*M;
    const photo = d.photo && d.photo.img && d.photo.img.naturalWidth ? d.photo : null;
    const S = this.px = photo ? Math.min(3, 4096 / Math.max(this.gw, this.gh)) : Math.min(2, 4000 / Math.max(this.gw, this.gh));  // pixels per metre
    const cv = document.createElement('canvas'); cv.width = Math.round(this.gw * S); cv.height = Math.round(this.gh * S);
    const g = cv.getContext('2d');
    const T = (x, y) => [(x - this.gx0) * S, (this.gy0 + this.gh - y) * S];
    const path = a => { g.beginPath(); for (let i = 0; i < a.length; i += 2){ const [px, py] = T(a[i], a[i+1]); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); };
    const line = a => { g.beginPath(); for (let i = 0; i < a.length; i += 2){ const [px, py] = T(a[i], a[i+1]); i ? g.lineTo(px, py) : g.moveTo(px, py); } };
    const speckle = (col, n, size) => { const r = rng(n); g.fillStyle = col; for (let i = 0; i < n; i++) g.fillRect(r()*cv.width, r()*cv.height, size, size); };
    // off course
    g.fillStyle = PAL.off; g.fillRect(0, 0, cv.width, cv.height); speckle(PAL.offDots, 60000, 2);
    // course (rough), clipped to the boundary
    g.save(); g.beginPath();
    for (const b of d.bounds){ for (let i = 0; i < b.length; i += 2){ const [px, py] = T(b[i], b[i+1]); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); }
    g.clip(); g.fillStyle = PAL.rough; g.fillRect(0, 0, cv.width, cv.height); speckle(PAL.roughDots, 90000, 2); g.restore();
    // fairways with mowing stripes
    for (const f of d.fairways){ g.save(); path(f); g.fillStyle = PAL.fairway; g.fill(); g.clip();
      g.strokeStyle = PAL.fairStripe; g.lineWidth = 7 * S;
      for (let k = -cv.height; k < cv.width + cv.height; k += 14 * S){ g.beginPath(); g.moveTo(k, 0); g.lineTo(k - cv.height * 0.35, cv.height); g.stroke(); }
      g.restore(); }
    for (const t of d.tees){ path(t); g.fillStyle = PAL.tee; g.fill(); }
    for (const gr of d.greens){ path(gr); g.strokeStyle = PAL.fringe; g.lineWidth = 3.6 * S; g.stroke(); g.fillStyle = PAL.green; g.fill(); }
    for (const b of d.bunkers){ path(b); g.strokeStyle = PAL.sandEdge; g.lineWidth = 1.2 * S; g.fillStyle = PAL.sand; g.fill(); g.stroke(); }
    for (const w of d.water){ path(w); g.fillStyle = PAL.water; g.fill(); g.strokeStyle = PAL.waterEdge; g.lineWidth = 1 * S; g.stroke(); }
    if (photo){
      // the real aerial photo over the painted map; the bunkers stay faintly outlined so you can see what plays as sand
      const [ax, ay] = T(photo.x0, photo.y1), [bx, by] = T(photo.x1, photo.y0);
      g.drawImage(photo.img, ax, ay, bx - ax, by - ay);
      g.save(); g.globalAlpha = 0.28; for (const b of d.bunkers){ path(b); g.fillStyle = PAL.sand; g.fill(); } g.restore();
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (photo) for (const cr of d.creeks){ line(cr); g.strokeStyle = 'rgba(38, 66, 58, 0.55)'; g.lineWidth = 3.4 * S; g.stroke(); }   // the photo shows the real creek: just darken its bed
    else for (const cr of d.creeks){ line(cr); g.strokeStyle = PAL.waterEdge; g.lineWidth = 6.5 * S; g.stroke(); line(cr); g.strokeStyle = PAL.water; g.lineWidth = 4.6 * S; g.stroke(); }
    // white out-of-bounds line
    g.setLineDash([2*S, 3*S]); g.strokeStyle = PAL.ob; g.lineWidth = 0.6 * S;
    for (const b of d.bounds.concat(d.ob || [])){ path(b); g.stroke(); } g.setLineDash([]);
    // tree shadows baked into the ground, cast away from the sun
    { const sx = -SUN.x / SUN.y, sy = SUN.z / SUN.y;         // ground offset per metre of height (course x, y)
      // drawn solid on their own layer (so overlapping shadows don't stack), then blurred onto the ground once
      const sc = document.createElement('canvas'); sc.width = cv.width; sc.height = cv.height; const h = sc.getContext('2d');
      h.fillStyle = '#000'; h.strokeStyle = '#000'; h.lineWidth = 0.6 * S;
      h.beginPath();
      for (const t of c.trees){ const hc = t.base + (t.h - t.base) * 0.45, [px, py] = T(t.x + sx * hc, t.y + sy * hc);
        h.moveTo(px + t.r * S, py); h.ellipse(px, py, t.r * S, t.r * S * 0.92, 0, 0, Math.PI * 2); }
      h.fill(); h.beginPath();
      for (const t of c.trees){ const [tx, ty] = T(t.x + sx * t.base * 0.6, t.y + sy * t.base * 0.6), [bx, by] = T(t.x, t.y); h.moveTo(bx, by); h.lineTo(tx, ty); }
      h.stroke();
      g.save(); g.globalAlpha = photo ? 0.28 : 0.4; g.filter = 'blur(' + Math.round(1.5 * S) + 'px)'; g.drawImage(sc, 0, 0); g.restore(); }
    this.groundCanvas = cv;
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); tex.minFilter = THREE.LinearMipmapLinearFilter;
    // ground follows the real terrain (a vertex every 2 m with 1 m LiDAR, else every 5 m)
    const MS = this.terrain.mesh || 5, SX = Math.round(this.gw / MS), SY = Math.round(this.gh / MS);
    const geo = new THREE.PlaneGeometry(this.gw, this.gh, SX, SY); geo.rotateX(-Math.PI / 2);
    { const p = geo.attributes.position, cx = this.gx0 + this.gw/2, cy = this.gy0 + this.gh/2;
      if (photo) this.waterLevels();
      for (let i = 0; i < p.count; i++){ const x = p.getX(i) + cx, y = -p.getZ(i) + cy; let h = this.terrain.height(x, y);
        // ground under open water drops below the water surface, so the surface is clean
        if (this.waterLv) for (const w of this.waterLv){ if (x < w.b[0] - 2 || x > w.b[2] + 2 || y < w.b[1] - 2 || y > w.b[3] + 2) continue; if (GolfGeo.pip(x, y, w.a) || GolfGeo.edgeDist(x, y, w.a) < 1.5) h = Math.min(h, w.lvl - 0.35); }
        p.setY(i, h); }
      // keep the vertex heights so the ball can sit exactly on the drawn ground (see meshHeight)
      this.gm = {SX, SY, h: Float32Array.from({length: p.count}, (_, i) => p.getY(i))};
      geo.computeVertexNormals(); }
    const mesh = new THREE.Mesh(geo, grassDetail(new THREE.MeshLambertMaterial({map: tex})));
    mesh.position.set(this.gx0 + this.gw/2, 0, -(this.gy0 + this.gh/2));
    this.scene.add(mesh);
    if (photo) this.buildWater();
    // far ground so the horizon isn't empty
    const far = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI/2), new THREE.MeshLambertMaterial({color: photo ? photo.edge : '#7a8f5c'}));
    far.position.set(mesh.position.x, -0.6, mesh.position.z); this.scene.add(far);
    // a few suburban roofs outside the course
    const r = rng(77), roofs = [], geoB = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 420; i++){ const x = this.gx0 - 250 + r() * (this.gw + 500), y = this.gy0 - 250 + r() * (this.gh + 500);
      if (this.course.inWater(x, y) || (d.sea && this.terrain.height(x, y) + (this.terrain.lo || 0) < 2.5)) continue;   // not in the harbour
      if (photo && x > this.gx0 && x < this.gx0 + this.gw && y > this.gy0 && y < this.gy0 + this.gh) continue;   // the photo already shows the real houses
      if (this.course.inBounds(x, y) || this.course.inBounds(x + 25, y) || this.course.inBounds(x - 25, y) || this.course.inBounds(x, y + 25) || this.course.inBounds(x, y - 25)) continue;
      roofs.push([x, y, 10 + r()*8, 12 + r()*8, 4 + r()*3, r()]); }
    const houses = new THREE.InstancedMesh(geoB, new THREE.MeshLambertMaterial({color: '#ffffff'}), roofs.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    roofs.forEach((h, i) => { m.compose(W(h[0], h[1], this.terrain.height(h[0], h[1]) + h[4]/2 - 0.5), new THREE.Quaternion(), new THREE.Vector3(h[2], h[4], h[3]));
      houses.setMatrixAt(i, m); houses.setColorAt(i, col.set(['#c9b8a6', '#a65d4b', '#8d8f94', '#d8d2c4'][Math.floor(h[5]*4)])); });
    this.scene.add(houses);
  }

  // Open water as a real surface: flat at the water's level, blue and glossy with the sky in it
  // (from above, a photo of water is nearly black).
  waterLevels(){
    // each pond's level: the low ground inside its outline (LiDAR reads the water surface, with some noise)
    const r = rng(5); this.waterLv = [];
    for (const w of this.course.d.water){
      const b = GolfGeo.bbox(w), hs = [];
      for (let k = 0; k < 600 && hs.length < 80; k++){ const x = b[0] + r() * (b[2] - b[0]), y = b[1] + r() * (b[3] - b[1]); if (GolfGeo.pip(x, y, w)) hs.push(this.terrain.height(x, y)); }
      if (!hs.length) continue;
      hs.sort((p, q) => p - q); this.waterLv.push({a: w, b, lvl: hs[Math.floor(hs.length * 0.4)]});
    }
  }
  buildWater(){
    const mat = new THREE.MeshPhongMaterial({color: '#2e6e9f', specular: '#e4f1ff', shininess: 70, emissive: '#0c2a44', transparent: true, opacity: 0.9});
    // the sky reflects more at a low angle (Fresnel), with a slow ripple of light and dark
    mat.customProgramCacheKey = () => 'water';
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWW;
float wh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(wh(i), wh(i+vec2(1,0)), f.x), mix(wh(i+vec2(0,1)), wh(i+vec2(1,1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{ vec3 v = normalize(cameraPosition - vWW); float fr = pow(1.0 - clamp(v.y, 0.0, 1.0), 6.0);
  float rip = wn(vWW.xz * 0.35) * 0.6 + wn(vWW.xz * 1.3) * 0.4;
  diffuseColor.rgb = mix(diffuseColor.rgb * (0.85 + rip * 0.3), vec3(0.45, 0.66, 0.86), fr * 0.5); }`);
    };
    for (const w of this.waterLv || []){
      const pts = []; for (let i = 0; i < w.a.length; i += 2) pts.push(new THREE.Vector2(w.a[i], w.a[i + 1]));
      if (pts.length < 3) continue;
      const geo = new THREE.ShapeGeometry(new THREE.Shape(pts)); geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat); m.position.y = w.lvl; m.renderOrder = 1; this.scene.add(m);
    }
  }
  buildFlag(){
    const grp = this.flag = new THREE.Group();
    // real sizes: 2.13 m pin, 10.8 cm cup
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 2.13, 8), new THREE.MeshLambertMaterial({color: '#f4f4f4'}));
    pole.position.y = 1.065; grp.add(pole); this.pole = pole;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4, 6, 1), new THREE.MeshLambertMaterial({color: '#e23b2e', side: THREE.DoubleSide}));
    cloth.geometry.translate(0.3, 0, 0); cloth.position.set(0, 1.9, 0); grp.add(cloth); this.cloth = cloth;
    // The cup is a real hole: its opening marks the stencil buffer, and the inside wall, the bottom
    // and a ball dropping in are only drawn through that opening.
    const R = this.CUP = GolfPhysics.CUP, inStencil = m => Object.assign(m, {stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.KeepStencilOp, depthTest: false, depthWrite: false});
    const open = new THREE.Mesh(new THREE.CircleGeometry(R, 32).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({color: '#1d241b', stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp, polygonOffset: true, polygonOffsetFactor: -4}));
    open.position.y = 0.014; open.renderOrder = -3; grp.add(open);   // drawn first, so the green can't paint over it
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.11, 32, 1, true), inStencil(new THREE.MeshLambertMaterial({color: '#5a5446', side: THREE.BackSide})));
    wall.position.y = 0.014 - 0.055; wall.renderOrder = -2; grp.add(wall);
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.995, R * 0.995, 0.028, 32, 1, true), inStencil(new THREE.MeshLambertMaterial({color: '#f1efe8', side: THREE.BackSide})));
    liner.position.y = 0.014 - 0.016; liner.renderOrder = -1; grp.add(liner);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(R, 24).rotateX(-Math.PI/2), inStencil(new THREE.MeshBasicMaterial({color: '#3b3a33'})));
    bottom.position.y = 0.014 - 0.105; bottom.renderOrder = -2; grp.add(bottom);
    this.cupGlow = new THREE.Mesh(new THREE.RingGeometry(R, R + 0.012, 32).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4}));
    this.cupGlow.position.y = 0.015; grp.add(this.cupGlow);
    // while reading the green: the hole drawn on top of the slope grid (dark cup, white lip, and a
    // bright target ring) so it is easy to find
    const rc = this.readCup = new THREE.Group(); rc.visible = false; grp.add(rc);
    const top = (m, o) => Object.assign(m, {depthWrite: false, polygonOffset: true, polygonOffsetFactor: o, polygonOffsetUnits: o});
    const hole = new THREE.Mesh(new THREE.CircleGeometry(R, 32).rotateX(-Math.PI/2), top(new THREE.MeshBasicMaterial({color: '#141a12'}), -8));
    const lip = new THREE.Mesh(new THREE.RingGeometry(R, R + 0.03, 32).rotateX(-Math.PI/2), top(new THREE.MeshBasicMaterial({color: '#ffffff'}), -8));
    const tgt = new THREE.Mesh(new THREE.RingGeometry(R * 3.2, R * 3.2 + 0.07, 48).rotateX(-Math.PI/2), top(new THREE.MeshBasicMaterial({color: '#ffe066', transparent: true, opacity: 0.95}), -8));
    [hole, lip, tgt].forEach(m => { m.position.y = 0.03; m.renderOrder = 4; rc.add(m); }); this.readTarget = tgt;
    // tall marker so the pin is visible from the tee
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 26, 8, 1, true), new THREE.MeshBasicMaterial({color: '#ffe066', transparent: true, opacity: 0.35, depthWrite: false}));
    beam.position.y = 16; grp.add(beam); this.beam = beam;
    this.scene.add(grp);
  }
  buildSky(){
    // painted sky dome: deep blue overhead, hazy near the horizon, with soft fair-weather clouds
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1024; const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, cv.height / 2);
    grad.addColorStop(0, '#3f8fd8'); grad.addColorStop(0.55, '#7db8e8'); grad.addColorStop(0.9, '#c9e1f1'); grad.addColorStop(1, '#e4eef2');
    g.fillStyle = grad; g.fillRect(0, 0, cv.width, cv.height / 2); g.fillStyle = '#e4eef2'; g.fillRect(0, cv.height / 2, cv.width, cv.height / 2);
    const R = rng(77);
    for (let i = 0; i < 70; i++){
      // clouds sit between about 5° and 40° above the horizon, flatter and smaller further away
      const e = 0.06 + Math.pow(R(), 1.6) * 0.38, y = cv.height / 2 - e * cv.height, x = R() * cv.width, w = (40 + R() * 160) * (0.5 + e * 2.2), h = w * (0.22 + R() * 0.12);
      for (let k = 0; k < 7; k++){
        const cx = x + (R() - 0.5) * w * 1.2, cy = y + (R() - 0.6) * h, r = w * (0.25 + R() * 0.3);
        for (const dx of [0, cv.width, -cv.width]){
          const rg = g.createRadialGradient(cx + dx, cy, 0, cx + dx, cy, r); rg.addColorStop(0, 'rgba(255,255,255,0.55)'); rg.addColorStop(0.6, 'rgba(250,252,255,0.25)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = rg; g.save(); g.translate(cx + dx, cy); g.scale(1, h / r * 1.4); g.translate(-(cx + dx), -cy); g.beginPath(); g.arc(cx + dx, cy, r, 0, Math.PI * 2); g.fill(); g.restore(); }
      }
    }
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), new THREE.MeshBasicMaterial({map: tex, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false}));
    this.sky.renderOrder = -10; this.scene.add(this.sky);
  }
  buildBall(){
    // a real golf ball is 42.7 mm across; it only grows when far from the camera so it stays visible
    this.BR = 0.02135;
    this.ballMat = new THREE.MeshLambertMaterial({color: '#ffffff', emissive: '#5a5a5a'});
    this.ballCupMat = Object.assign(this.ballMat.clone(), {stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.KeepStencilOp, depthTest: false, depthWrite: false});
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(this.BR, 20, 16), this.ballMat);
    // thin dark outline so the ball stands out on light grass (drawn as an inside-out shell)
    this.ballEdge = new THREE.Mesh(new THREE.SphereGeometry(this.BR * 1.22, 20, 16), new THREE.MeshBasicMaterial({color: '#1c2a18', side: THREE.BackSide, transparent: true, opacity: 0.55}));
    this.ball.add(this.ballEdge);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(this.BR * 1.2, 16).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({color: '#000000', transparent: true, opacity: 0.35, depthWrite: false}));
    this.scene.add(this.ball, this.shadow);
    // white trail behind the ball in flight
    this.trailPts = []; this.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color: '#ffffff', transparent: true, opacity: 0.7}));
    this.trail.frustumCulled = false; this.scene.add(this.trail);
  }
  buildAim(){
    this.aimDots = new THREE.Group(); this.scene.add(this.aimDots);
    const dotGeo = new THREE.CircleGeometry(0.5, 12).rotateX(-Math.PI/2), mat = new THREE.MeshBasicMaterial({color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false});
    for (let i = 0; i < 40; i++){ const dm = new THREE.Mesh(dotGeo, mat); dm.position.y = 0.05; this.aimDots.add(dm); }
    this.ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.2, 40).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({color: '#ffe066', transparent: true, opacity: 0.9, depthWrite: false}));
    this.ring.position.y = 0.06; this.scene.add(this.ring);
  }

  // Height of the ground as drawn. The ground mesh is flat triangles between points 5 m apart, which can
  // sit a little above the smooth height model; using it keeps the ball from sinking into the grass.
  meshHeight(x, y){
    const g = this.gm; if (!g) return this.terrain.height(x, y);
    const fx = (x - this.gx0) / this.gw * g.SX, fy = (this.gy0 + this.gh - y) / this.gh * g.SY;
    const i = Math.max(0, Math.min(g.SX - 1, Math.floor(fx))), j = Math.max(0, Math.min(g.SY - 1, Math.floor(fy))), u = fx - i, v = fy - j, n = g.SX + 1;
    const a = g.h[j * n + i], b = g.h[(j + 1) * n + i], c = g.h[(j + 1) * n + i + 1], d = g.h[j * n + i + 1];
    return u + v <= 1 ? a + (d - a) * u + (b - a) * v : c + (b - c) * (1 - u) + (d - c) * (1 - v);
  }
  ground(x, y){ const base = Math.max(this.meshHeight(x, y), this.terrain.height(x, y)) + 0.01, f = this.greenAt(x, y); return f ? Math.max(base, f.height(x, y) + 0.012) : base; }
  greenAt(x, y){ for (const f of this.fields){ const b = f.b; if (x < b[0] - 3 || x > b[2] + 3 || y < b[1] - 3 || y > b[3] + 3) continue; if (GolfGeo.pip(x, y, f.poly) || GolfGeo.edgeDist(x, y, f.poly) < 2) return f; } return null; }   // the green mesh reaches ~2 m past its edge
  // the flagstick comes out when putting (the physics leaves it in for chips and full shots)
  setFlagIn(on){ this.pole.visible = on; this.cloth.visible = on; }
  setPin(x, y){ this.flag.position.copy(W(x, y, this.ground(x, y))); this.pin = [x, y]; }
  setBall(x, y, h = 0, trail = false){
    const g = this.ground(x, y);
    this.ballY0 = g + h; this.ball.position.copy(W(x, y, g + h + this.BR * this.ballScale)); this.shadow.position.copy(W(x, y, g + 0.004)); this.shadow.visible = h > -0.01;
    // dropping into the cup: only visible through the hole
    const inCup = h < -0.004; if (this.ball.material !== (inCup ? this.ballCupMat : this.ballMat)){ this.ball.material = inCup ? this.ballCupMat : this.ballMat; this.ball.renderOrder = inCup ? 5 : 0; this.ballEdge.visible = !inCup; }
    if (trail){ this.trailPts.push(this.ball.position.clone()); if (this.trailPts.length > 160) this.trailPts.shift(); this.trail.geometry.setFromPoints(this.trailPts); this.trail.visible = true; }
  }
  // ---------- grass ----------
  // Real tufts of grass around the ball, so the ground up close isn't a smooth (or blurry) photo.
  // Rough gets taller, scruffier tufts; fairways and tees a short, sparse sward; nothing on greens,
  // sand, water or bare paths. Each tuft takes its colour from the ground right under it.
  buildGrass(){
    const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'), R = rng(41);
    for (let i = 0; i < 46; i++){
      const x = S * (0.08 + R() * 0.84), lean = (R() - 0.5) * S * 0.35, h = S * (0.45 + R() * 0.55), w = 1.6 + R() * 2.4, v = Math.round(150 + R() * 105);
      g.fillStyle = `rgb(${v},${v},${Math.round(v * 0.9)})`;
      g.beginPath(); g.moveTo(x - w, S); g.quadraticCurveTo(x + lean * 0.3, S - h * 0.6, x + lean, S - h); g.quadraticCurveTo(x + lean * 0.3 + w * 0.4, S - h * 0.6, x + w, S); g.fill();
    }
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
    // a tuft: three crossed upright cards, 1 m wide and 1 m tall (scaled per instance)
    const pos = [], nor = [], uv = [];
    for (let k = 0; k < 3; k++){ const a = k * Math.PI / 3, c = Math.cos(a) * 0.5, s2 = Math.sin(a) * 0.5;
      const P = [[-c, 0, -s2], [c, 0, s2], [c, 1, s2], [-c, 0, -s2], [c, 1, s2], [-c, 1, -s2]], U = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
      P.forEach((p, i) => { pos.push(...p); nor.push(0, 1, 0); uv.push(...U[i]); }); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const mat = new THREE.MeshLambertMaterial({map: tex, alphaTest: 0.45, side: THREE.DoubleSide});
    mat.customProgramCacheKey = () => 'grasstufts';
    mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal = normal * faceDirection;', '')); };
    this.grass = new THREE.InstancedMesh(geo, mat, 26000); this.grass.count = 0; this.grass.frustumCulled = false;
    this.scene.add(this.grass);
  }
  placeGrass(ball, ang){
    if (!this.grass) this.buildGrass();
    const gm = this.grass, c = this.course, cv = this.groundCanvas, S = this.px, r = rng(Math.round(ball[0] * 7 + ball[1] * 13));
    const ux = Math.cos(ang), uy = Math.sin(ang), back = 12, ahead = 70, side = 30;
    // the patch: a little behind the ball, mostly ahead of it where the camera looks
    const corners = [[-back, -side], [-back, side], [ahead, -side], [ahead, side]].map(([a, b]) => [ball[0] + ux * a - uy * b, ball[1] + uy * a + ux * b]);
    const x0 = Math.min(...corners.map(p => p[0])), x1 = Math.max(...corners.map(p => p[0])), y0 = Math.min(...corners.map(p => p[1])), y1 = Math.max(...corners.map(p => p[1]));
    let img = null, ix0 = 0, iy0 = 0, iw = 0;
    try { ix0 = Math.max(0, Math.floor((x0 - this.gx0) * S)); iy0 = Math.max(0, Math.floor((this.gy0 + this.gh - y1) * S));
      iw = Math.min(cv.width - ix0, Math.ceil((x1 - x0) * S) + 2); const ih = Math.min(cv.height - iy0, Math.ceil((y1 - y0) * S) + 2);
      img = cv.getContext('2d').getImageData(ix0, iy0, iw, ih); } catch (e) {}
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (let tries = 0; tries < 60000 && n < gm.instanceMatrix.count; tries++){
      // denser near the ball, thinner far away
      const a = -back + Math.pow(r(), 1.5) * (ahead + back), b = (r() * 2 - 1) * side * (0.5 + 0.5 * Math.min(1, (a + back) / 30));
      const x = ball[0] + ux * a - uy * b, y = ball[1] + uy * a + ux * b;
      if (Math.hypot(x - ball[0], y - ball[1]) < 0.6) continue;                      // keep the ball itself clear
      const lie = c.lie(x, y);
      if (lie === 'green' || lie === 'fringe' || lie === 'bunker' || lie === 'water' || lie === 'ob') continue;
      const rough = lie === 'rough';
      if (!rough && r() > 0.45) continue;                                           // fairways: a sparser, short sward
      let R0 = 0.33, G0 = 0.5, B0 = 0.22;
      if (img){ const px = Math.floor((x - this.gx0) * S) - ix0, py = Math.floor((this.gy0 + this.gh - y) * S) - iy0;
        if (px >= 0 && py >= 0 && px < img.width && py < img.height){ const k = (py * img.width + px) * 4, d = img.data; R0 = d[k] / 255; G0 = d[k + 1] / 255; B0 = d[k + 2] / 255; }
        if (G0 < R0 * 1.04 || G0 < 0.16) continue; }                               // bare earth, paths, deep shade: no grass
      const h = rough ? 0.09 + r() * 0.13 : 0.035 + r() * 0.03, w = rough ? 0.22 + r() * 0.2 : 0.2 + r() * 0.12;
      q.setFromAxisAngle(up, r() * Math.PI);
      m.compose(W(x, y, this.ground(x, y) - 0.02), q, sc.set(w, h, w));
      gm.setMatrixAt(n, m);
      const f = (0.95 + r() * 0.25) * 1.45;   // the blade texture is mid-grey, so lift the colour to match the ground
      col.setRGB(R0, G0 * 1.04, B0).convertSRGBToLinear().multiplyScalar(f); gm.setColorAt(n, col); n++;
    }
    gm.count = n; gm.instanceMatrix.needsUpdate = true; if (gm.instanceColor) gm.instanceColor.needsUpdate = true;
  }
  // the other player's ball: a coloured ball with a thin pole and disc so it can be found from anywhere
  setOthers(list){
    if (!this.others){ this.others = new THREE.Group(); this.scene.add(this.others); }
    while (this.others.children.length){ const o = this.others.children.pop(); o.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }); }
    for (const o of list || []){
      if (!o || o.x == null) continue;
      const g = new THREE.Group(), h = this.ground(o.x, o.y), col = new THREE.Color(o.color || '#e0602a');
      const b = new THREE.Mesh(new THREE.SphereGeometry(this.BR * 2, 14, 10), new THREE.MeshLambertMaterial({color: col, emissive: col.clone().multiplyScalar(0.35)}));
      b.position.y = this.BR * 2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.6, 6), new THREE.MeshBasicMaterial({color: col}));
      pole.position.y = 1.8;
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), new THREE.MeshBasicMaterial({color: col}));
      top.position.y = 3.7;
      g.add(b, pole, top); g.position.copy(W(o.x, o.y, h)); this.others.add(g);
    }
  }
  clearTrail(){ this.trailPts = []; this.trail.visible = false; }
  placeGolfer(b, ang, putt){ this.golfer.place(W(b[0], b[1], this.ground(b[0], b[1])), ang, putt); this.golfer.visible = true; }
  buildGreens(){
    this.fields = []; this.reads = [];
    this.course.d.greens.forEach((poly, i) => {
      const f = new GolfGreens.GreenField(poly, 900 + i * 31, (x, y) => this.terrain.height(x, y), this.terrain.realGreens); this.fields.push(f);
      if (this.course.d.photo && this.groundCanvas && this.px){
        // the green's own colour in the photo (the 3D green sits on top of it)
        const g = this.groundCanvas.getContext('2d'), S = this.px, x0 = (f.b[0] - this.gx0) * S, y0 = (this.gy0 + this.gh - f.b[3]) * S;
        const w = Math.max(1, Math.round((f.b[2] - f.b[0]) * S)), h = Math.max(1, Math.round((f.b[3] - f.b[1]) * S));
        try { const px = g.getImageData(Math.round(x0), Math.round(y0), w, h).data; let r = 0, gg = 0, bb = 0, n = 0;
          for (let j = 0; j < h; j += 2) for (let i = 0; i < w; i += 2){ const X = f.b[0] + i / S, Y = f.b[3] - j / S; if (!GolfGeo.pip(X, Y, f.poly)) continue; const k = (j * w + i) * 4; r += px[k]; gg += px[k + 1]; bb += px[k + 2]; n++; }
          if (n > 20){ f.tone = `rgb(${Math.round(r / n)}, ${Math.round(gg / n)}, ${Math.round(bb / n)})`; } } catch (e) {}
      }
      const mesh = GolfGreens.greenMesh(f, W); grassDetail(mesh.material, true); this.scene.add(mesh);
      const read = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2}));
      read.visible = false; read.userData = mesh.userData; read.renderOrder = 2; this.scene.add(read); this.reads.push(read);
    });
  }
  showRead(i, on){
    this.reads.forEach((r, k) => { r.visible = on && k === i; });
    if (this.readCup) this.readCup.visible = !!on;
    const r = this.reads[i]; if (on && r && !r.material.map){ r.material.map = GolfGreens.readTexture(this.fields[i], r.userData.size, r.userData.origin); r.material.needsUpdate = true; }
  }
  showAim(from, ang, dist, putt){
    const vis = dist > 0; this.aimDots.visible = vis; this.ring.visible = vis; if (!vis) return;
    const n = this.aimDots.children.length, ux = Math.cos(ang), uy = Math.sin(ang);
    const step = Math.max(0.6, dist / n);
    this.aimDots.children.forEach((m, i) => { const s = step * (i + 1); const x = from[0] + ux*s, y = from[1] + uy*s; m.visible = s < dist && s > (putt ? 0.3 : 3); m.position.copy(W(x, y, this.ground(x, y) + 0.03)); m.scale.setScalar(putt ? 0.06 : Math.min(1.6, 0.08 + s/90)); });
    const ex = from[0] + ux*dist, ey = from[1] + uy*dist; this.ring.position.copy(W(ex, ey, this.ground(ex, ey) + 0.04)); this.ring.scale.setScalar(putt ? 0.05 : Math.max(0.4, dist / 110));
  }

  // ---------- camera ----------
  view(mode, opts){
    const b = opts.ball, ang = opts.ang;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const rx = Math.sin(ang), ry = -Math.cos(ang), g0 = b ? this.ground(b[0], b[1]) : 0;
    if (mode === 'address'){
      // just behind the golfer, looking down the line like the Wii
      const back = opts.putt ? 3.3 : 5.2, up = opts.putt ? 1.6 : 2.1, side = opts.putt ? 0.45 : 0.3, ahead = opts.putt ? Math.max(3, opts.toPin * 0.7) : 60;
      this.camGoalPos.copy(W(b[0] - ux*back + rx*side, b[1] - uy*back + ry*side, g0 + up));
      const ax = b[0] + ux*ahead, ay = b[1] + uy*ahead; this.camGoalLook.copy(W(ax, ay, this.ground(ax, ay)));
    } else if (mode === 'follow'){
      const h = opts.h || 0;
      const gb = this.ground(b[0], b[1]), gc = this.ground(b[0] - ux*14, b[1] - uy*14);
      this.camGoalPos.copy(W(b[0] - ux*14, b[1] - uy*14, Math.max(gc + 2, gb + 3 + h * 0.75))); this.camGoalLook.copy(W(b[0] + ux*10, b[1] + uy*10, gb + h * 0.85));
    } else if (mode === 'watch'){
      this.camGoalLook.copy(W(b[0], b[1], this.ground(b[0], b[1])));
    } else if (mode === 'map'){
      const c = opts.center, span = opts.span;
      const gc = this.terrain.height(c[0], c[1]);
      this.camGoalPos.copy(W(c[0] - ux*span*0.35, c[1] - uy*span*0.35, gc + span * 0.95)); this.camGoalLook.copy(W(c[0] + ux*span*0.05, c[1] + uy*span*0.05, gc));
    }
    if (opts.snap){ this.camPos.copy(this.camGoalPos); this.camLook.copy(this.camGoalLook); }
  }
  frame(dt, t){
    if (this.readCup && this.readCup.visible){ const k = 1 + 0.12 * Math.sin(t * 4); this.readTarget.scale.set(k, 1, k); }   // gentle pulse
    const k = 1 - Math.pow(0.0015, dt);
    this.camPos.lerp(this.camGoalPos, k); this.camLook.lerp(this.camGoalLook, k);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook); this.sky.position.copy(this.camPos); this.trees.update(this.camPos);
    if (this.cloth) this.cloth.rotation.y = Math.sin(t * 2.3) * 0.25;
    const dist = this.camera.position.distanceTo(this.flag.position); this.beam.visible = dist > 60;
    // keep the ball a few pixels wide however far away it is
    // drawn a bit bigger than real (in proportion to the bigger cup), and never smaller than a few pixels
    const bd = this.camera.position.distanceTo(this.ball.position); this.ballScale = Math.max(2, bd / 6);
    this.ball.scale.setScalar(this.ballScale); if (this.ballY0 != null) this.ball.position.y = this.ballY0 + this.BR * this.ballScale;   this.shadow.scale.setScalar(this.ballScale * 1.1);   // ball sits on the ground at any size
    this.ballEdge.material.opacity = bd < 12 ? 0.55 : 0.25;
    this.golfer.update(dt, t);
    this.renderer.render(this.scene, this.camera);
  }
  resize(){ const c = this.renderer.domElement, w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
}
window.GolfScene = GolfScene;
window.GolfW = W;
})();
