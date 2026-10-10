// 3D view: course ground painted from the map, trees, flag, ball and the camera.
// three.js world: X = east, Z = south (so course y maps to -Z), Y = up.
(function(){
'use strict';
const {centroid, rng} = window.GolfGeo;
const W = (x, y, h = 0) => new THREE.Vector3(x, h, -y);

const PAL = {
  off: '#7d8f62', offDots: '#6f8156', rough: '#4f8f3a', roughDots: '#447f33',
  fairway: '#7cc04a', fairStripe: '#86c955', green: '#8fd65a', fringe: '#6cb846',
  tee: '#83c652', sand: '#ead9a6', sandEdge: '#d9c48a', water: '#3f86c6', waterEdge: '#2f6ea6', ob: '#ffffff'
};

class GolfScene {
  constructor(canvas, course){
    this.course = course; this.terrain = course.terrain || GolfTerrain.Flat;
    const r = this.renderer = new THREE.WebGLRenderer({canvas, antialias: true});
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputEncoding = THREE.sRGBEncoding;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color('#9fd3f5');
    s.fog = new THREE.Fog('#bfe2f7', 350, 1100);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.03, 3000);
    s.add(new THREE.HemisphereLight('#e8f6ff', '#5a7d3a', 0.75));
    const sun = new THREE.DirectionalLight('#fff6e0', 0.85); sun.position.set(-300, 500, 200); s.add(sun);
    this.buildGround(); GolfTrees.build(s, course.trees, (x, y) => this.terrain.height(x, y)); this.buildGreens(); this.buildFlag(); this.buildBall(); this.buildAim();
    this.golfer = new GolfGolfer(s);
    this.camPos = new THREE.Vector3(0, 50, 50); this.camLook = new THREE.Vector3();
    this.camGoalPos = this.camPos.clone(); this.camGoalLook = new THREE.Vector3();
    this.resize();
  }

  // ---------- ground ----------
  buildGround(){
    const c = this.course, d = c.d, [x0, y0, x1, y1] = c.extent, M = 90;
    this.gx0 = x0 - M; this.gy0 = y0 - M; this.gw = (x1 - x0) + 2*M; this.gh = (y1 - y0) + 2*M;
    const S = this.px = Math.min(2, 4000 / Math.max(this.gw, this.gh));  // pixels per metre
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
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const cr of d.creeks){ line(cr); g.strokeStyle = PAL.waterEdge; g.lineWidth = 6.5 * S; g.stroke(); line(cr); g.strokeStyle = PAL.water; g.lineWidth = 4.6 * S; g.stroke(); }
    // white out-of-bounds line
    g.setLineDash([2*S, 3*S]); g.strokeStyle = PAL.ob; g.lineWidth = 0.6 * S;
    for (const b of d.bounds){ path(b); g.stroke(); } g.setLineDash([]);
    this.groundCanvas = cv;
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); tex.minFilter = THREE.LinearMipmapLinearFilter;
    // ground follows the real terrain (one vertex every ~5 m)
    const geo = new THREE.PlaneGeometry(this.gw, this.gh, Math.round(this.gw / 5), Math.round(this.gh / 5)); geo.rotateX(-Math.PI / 2);
    { const p = geo.attributes.position, cx = this.gx0 + this.gw/2, cy = this.gy0 + this.gh/2;
      for (let i = 0; i < p.count; i++) p.setY(i, this.terrain.height(p.getX(i) + cx, -p.getZ(i) + cy));
      geo.computeVertexNormals(); }
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({map: tex}));
    mesh.position.set(this.gx0 + this.gw/2, 0, -(this.gy0 + this.gh/2));
    this.scene.add(mesh);
    // far ground so the horizon isn't empty
    const far = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI/2), new THREE.MeshLambertMaterial({color: '#7a8f5c'}));
    far.position.set(mesh.position.x, -0.6, mesh.position.z); this.scene.add(far);
    // a few suburban roofs outside the course
    const r = rng(77), roofs = [], geoB = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 420; i++){ const x = this.gx0 - 250 + r() * (this.gw + 500), y = this.gy0 - 250 + r() * (this.gh + 500);
      if (this.course.inBounds(x, y) || this.course.inBounds(x + 25, y) || this.course.inBounds(x - 25, y) || this.course.inBounds(x, y + 25) || this.course.inBounds(x, y - 25)) continue;
      roofs.push([x, y, 10 + r()*8, 12 + r()*8, 4 + r()*3, r()]); }
    const houses = new THREE.InstancedMesh(geoB, new THREE.MeshLambertMaterial({color: '#ffffff'}), roofs.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    roofs.forEach((h, i) => { m.compose(W(h[0], h[1], this.terrain.height(h[0], h[1]) + h[4]/2 - 0.5), new THREE.Quaternion(), new THREE.Vector3(h[2], h[4], h[3]));
      houses.setMatrixAt(i, m); houses.setColorAt(i, col.set(['#c9b8a6', '#a65d4b', '#8d8f94', '#d8d2c4'][Math.floor(h[5]*4)])); });
    this.scene.add(houses);
  }

  buildFlag(){
    const grp = this.flag = new THREE.Group();
    // real sizes: 2.13 m pin, 10.8 cm cup
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 2.13, 8), new THREE.MeshLambertMaterial({color: '#f4f4f4'}));
    pole.position.y = 1.065; grp.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4, 6, 1), new THREE.MeshLambertMaterial({color: '#e23b2e', side: THREE.DoubleSide}));
    cloth.geometry.translate(0.3, 0, 0); cloth.position.set(0, 1.9, 0); grp.add(cloth); this.cloth = cloth;
    const cup = new THREE.Mesh(new THREE.CircleGeometry(0.054, 24).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({color: '#141f14'}));
    cup.position.y = 0.006; grp.add(cup);
    const lip = new THREE.Mesh(new THREE.RingGeometry(0.054, 0.062, 24).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({color: '#f2f2f2'}));
    lip.position.y = 0.005; grp.add(lip);
    // tall marker so the pin is visible from the tee
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 26, 8, 1, true), new THREE.MeshBasicMaterial({color: '#ffe066', transparent: true, opacity: 0.35, depthWrite: false}));
    beam.position.y = 16; grp.add(beam); this.beam = beam;
    this.scene.add(grp);
  }
  buildBall(){
    // a real golf ball is 42.7 mm across; it only grows when far from the camera so it stays visible
    this.BR = 0.02135;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(this.BR, 18, 14), new THREE.MeshLambertMaterial({color: '#ffffff', emissive: '#4a4a4a'}));
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

  ground(x, y){ const f = this.greenAt(x, y); return f ? f.height(x, y) : this.terrain.height(x, y); }
  greenAt(x, y){ for (const f of this.fields){ const b = f.b; if (x < b[0] - 3 || x > b[2] + 3 || y < b[1] - 3 || y > b[3] + 3) continue; if (f.height(x, y) > 0 || GolfGeo.pip(x, y, f.poly)) return f; } return null; }
  setPin(x, y){ this.flag.position.copy(W(x, y, this.ground(x, y))); this.pin = [x, y]; }
  setBall(x, y, h = 0, trail = false){
    const g = this.ground(x, y);
    this.ball.position.copy(W(x, y, g + h + this.BR)); this.shadow.position.copy(W(x, y, g + 0.004)); this.shadow.scale.setScalar(1 + h * 0.03);
    if (trail){ this.trailPts.push(this.ball.position.clone()); if (this.trailPts.length > 160) this.trailPts.shift(); this.trail.geometry.setFromPoints(this.trailPts); this.trail.visible = true; }
  }
  clearTrail(){ this.trailPts = []; this.trail.visible = false; }
  placeGolfer(b, ang, putt){ this.golfer.place(W(b[0], b[1], this.ground(b[0], b[1])), ang, putt); this.golfer.visible = true; }
  buildGreens(){
    this.fields = []; this.reads = [];
    this.course.d.greens.forEach((poly, i) => {
      const f = new GolfGreens.GreenField(poly, 900 + i * 31, (x, y) => this.terrain.height(x, y)); this.fields.push(f);
      const mesh = GolfGreens.greenMesh(f, W); this.scene.add(mesh);
      const read = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2}));
      read.visible = false; read.userData = mesh.userData; read.renderOrder = 2; this.scene.add(read); this.reads.push(read);
    });
  }
  showRead(i, on){
    this.reads.forEach((r, k) => { r.visible = on && k === i; });
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
    const k = 1 - Math.pow(0.0015, dt);
    this.camPos.lerp(this.camGoalPos, k); this.camLook.lerp(this.camGoalLook, k);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
    if (this.cloth) this.cloth.rotation.y = Math.sin(t * 2.3) * 0.25;
    const dist = this.camera.position.distanceTo(this.flag.position); this.beam.visible = dist > 60;
    // keep the ball a few pixels wide however far away it is
    const bd = this.camera.position.distanceTo(this.ball.position); this.ball.scale.setScalar(Math.max(1, bd / 7)); this.shadow.scale.setScalar(Math.max(1, bd / 7));
    this.golfer.update(dt, t);
    this.renderer.render(this.scene, this.camera);
  }
  resize(){ const c = this.renderer.domElement, w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
}
window.GolfScene = GolfScene;
window.GolfW = W;
})();
