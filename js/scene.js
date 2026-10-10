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
    this.course = course;
    const r = this.renderer = new THREE.WebGLRenderer({canvas, antialias: true});
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputEncoding = THREE.sRGBEncoding;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color('#9fd3f5');
    s.fog = new THREE.Fog('#bfe2f7', 350, 1100);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 3000);
    s.add(new THREE.HemisphereLight('#e8f6ff', '#5a7d3a', 0.75));
    const sun = new THREE.DirectionalLight('#fff6e0', 0.85); sun.position.set(-300, 500, 200); s.add(sun);
    this.buildGround(); this.buildTrees(); this.buildFlag(); this.buildBall(); this.buildAim();
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
    const geo = new THREE.PlaneGeometry(this.gw, this.gh); geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({map: tex}));
    mesh.position.set(this.gx0 + this.gw/2, 0, -(this.gy0 + this.gh/2));
    this.scene.add(mesh);
    // far ground so the horizon isn't empty
    const far = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI/2), new THREE.MeshLambertMaterial({color: '#7a8f5c'}));
    far.position.set(mesh.position.x, -0.05, mesh.position.z); this.scene.add(far);
    // a few suburban roofs outside the course
    const r = rng(77), roofs = [], geoB = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 420; i++){ const x = this.gx0 - 250 + r() * (this.gw + 500), y = this.gy0 - 250 + r() * (this.gh + 500);
      if (this.course.inBounds(x, y) || this.course.inBounds(x + 25, y) || this.course.inBounds(x - 25, y) || this.course.inBounds(x, y + 25) || this.course.inBounds(x, y - 25)) continue;
      roofs.push([x, y, 10 + r()*8, 12 + r()*8, 4 + r()*3, r()]); }
    const houses = new THREE.InstancedMesh(geoB, new THREE.MeshLambertMaterial({color: '#ffffff'}), roofs.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    roofs.forEach((h, i) => { m.compose(W(h[0], h[1], h[4]/2), new THREE.Quaternion(), new THREE.Vector3(h[2], h[4], h[3]));
      houses.setMatrixAt(i, m); houses.setColorAt(i, col.set(['#c9b8a6', '#a65d4b', '#8d8f94', '#d8d2c4'][Math.floor(h[5]*4)])); });
    this.scene.add(houses);
  }

  buildTrees(){
    const trees = this.course.trees, n = trees.length;
    const canopy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({color: '#ffffff', flatShading: true}), n);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 1, 6), new THREE.MeshLambertMaterial({color: '#6b4e33'}), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const greens = ['#2f6b2c', '#3b7a32', '#2a5f2e', '#4a7f3a', '#356f3c'];
    trees.forEach((t, i) => {
      const trunkH = t.h * 0.38, cr = t.r, ch = (t.h - trunkH) * (t.kind ? 0.75 : 0.6);
      m.compose(W(t.x, t.y, trunkH + ch * 0.55), q, new THREE.Vector3(cr, ch * (t.kind ? 1.1 : 0.85), cr)); canopy.setMatrixAt(i, m);
      canopy.setColorAt(i, col.set(greens[i % greens.length]));
      m.compose(W(t.x, t.y, trunkH / 2 + 0.5), q, new THREE.Vector3(1, trunkH + 1, 1)); trunk.setMatrixAt(i, m);
    });
    this.scene.add(canopy, trunk);
  }

  buildFlag(){
    const grp = this.flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8), new THREE.MeshLambertMaterial({color: '#f4f4f4'}));
    pole.position.y = 1.6; grp.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8), new THREE.MeshLambertMaterial({color: '#e23b2e', side: THREE.DoubleSide}));
    cloth.position.set(0.65, 2.75, 0); grp.add(cloth); this.cloth = cloth;
    const cup = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({color: '#1b2a1b'}));
    cup.position.y = 0.02; grp.add(cup);
    // tall marker so the pin is visible from the tee
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 26, 8, 1, true), new THREE.MeshBasicMaterial({color: '#ffe066', transparent: true, opacity: 0.35, depthWrite: false}));
    beam.position.y = 16; grp.add(beam); this.beam = beam;
    this.scene.add(grp);
  }
  buildBall(){
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshLambertMaterial({color: '#ffffff', emissive: '#555555'}));
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({color: '#000000', transparent: true, opacity: 0.35, depthWrite: false}));
    this.scene.add(this.ball, this.shadow);
  }
  buildAim(){
    this.aimDots = new THREE.Group(); this.scene.add(this.aimDots);
    const dotGeo = new THREE.CircleGeometry(0.5, 12).rotateX(-Math.PI/2), mat = new THREE.MeshBasicMaterial({color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false});
    for (let i = 0; i < 40; i++){ const dm = new THREE.Mesh(dotGeo, mat); dm.position.y = 0.05; this.aimDots.add(dm); }
    this.ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.2, 40).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({color: '#ffe066', transparent: true, opacity: 0.9, depthWrite: false}));
    this.ring.position.y = 0.06; this.scene.add(this.ring);
  }

  setPin(x, y){ this.flag.position.copy(W(x, y)); this.pin = [x, y]; }
  setBall(x, y, h = 0){ this.ball.position.copy(W(x, y, h + 0.22)); this.shadow.position.copy(W(x, y, 0.03)); this.shadow.scale.setScalar(1 + h * 0.02); }
  showAim(from, ang, dist, putt){
    const vis = dist > 0; this.aimDots.visible = vis; this.ring.visible = vis; if (!vis) return;
    const n = this.aimDots.children.length, ux = Math.cos(ang), uy = Math.sin(ang);
    const step = Math.max(0.6, dist / n);
    this.aimDots.children.forEach((m, i) => { const s = step * (i + 1); m.visible = s < dist; m.position.copy(W(from[0] + ux*s, from[1] + uy*s, 0.05)); m.scale.setScalar(putt ? 0.18 : Math.min(1.6, 0.35 + s/120)); });
    this.ring.position.copy(W(from[0] + ux*dist, from[1] + uy*dist, 0.06)); this.ring.scale.setScalar(putt ? 0.12 : Math.max(0.6, dist / 120));
  }

  // ---------- camera ----------
  view(mode, opts){
    const b = opts.ball, ang = opts.ang;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    if (mode === 'address'){
      const back = opts.putt ? 4.5 : 11, up = opts.putt ? 2.2 : 4, ahead = opts.putt ? Math.max(4, opts.toPin * 0.6) : 70;
      this.camGoalPos.copy(W(b[0] - ux*back, b[1] - uy*back, up)); this.camGoalLook.copy(W(b[0] + ux*ahead, b[1] + uy*ahead, 0));
    } else if (mode === 'follow'){
      const h = opts.h || 0;
      this.camGoalPos.copy(W(b[0] - ux*16, b[1] - uy*16, 5 + h * 0.6)); this.camGoalLook.copy(W(b[0] + ux*8, b[1] + uy*8, h * 0.8));
    } else if (mode === 'watch'){
      this.camGoalLook.copy(W(b[0], b[1], 0));
    } else if (mode === 'map'){
      const c = opts.center, span = opts.span;
      this.camGoalPos.copy(W(c[0] - ux*span*0.35, c[1] - uy*span*0.35, span * 0.95)); this.camGoalLook.copy(W(c[0] + ux*span*0.05, c[1] + uy*span*0.05, 0));
    }
    if (opts.snap){ this.camPos.copy(this.camGoalPos); this.camLook.copy(this.camGoalLook); }
  }
  frame(dt, t){
    const k = 1 - Math.pow(0.0015, dt);
    this.camPos.lerp(this.camGoalPos, k); this.camLook.lerp(this.camGoalLook, k);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
    if (this.cloth) this.cloth.rotation.y = Math.sin(t * 2.3) * 0.25;
    const dist = this.camera.position.distanceTo(this.flag.position); this.beam.visible = dist > 60;
    this.renderer.render(this.scene, this.camera);
  }
  resize(){ const c = this.renderer.domElement, w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
}
window.GolfScene = GolfScene;
window.GolfW = W;
})();
