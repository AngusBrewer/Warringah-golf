// A Mii-style golfer built from simple shapes, with address, swing and putting animations.
// Local frame: the golfer faces +X (toward the ball); the target is -Z (his left).
(function(){
'use strict';
const mat = c => new THREE.MeshLambertMaterial({color: c});
const SKIN = '#f2c7a0', SHIRT = '#3d97e6', PANTS = '#5b6576', HAIR = '#3b2a1e', SHOE = '#f4f4f4', CAP = '#ffffff';

function limb(len, r, m){ const g = new THREE.CylinderGeometry(r, r * 0.9, len, 10); g.translate(0, -len / 2, 0); return new THREE.Mesh(g, m); }

class Golfer {
  constructor(scene){
    const root = this.root = new THREE.Group();
    // legs
    const legL = limb(0.82, 0.075, mat(PANTS)), legR = limb(0.82, 0.075, mat(PANTS));
    legL.position.set(0, 0.86, -0.15); legR.position.set(0, 0.86, 0.15); legL.rotation.x = 0.08; legR.rotation.x = -0.08;
    const shoeG = new THREE.BoxGeometry(0.26, 0.08, 0.11); const shL = new THREE.Mesh(shoeG, mat(SHOE)), shR = new THREE.Mesh(shoeG, mat(SHOE));
    shL.position.set(0.04, 0.04, -0.21); shR.position.set(0.04, 0.04, 0.21);
    root.add(legL, legR, shL, shR);
    // hips + torso turn together during the swing
    const hips = this.hips = new THREE.Group(); hips.position.y = 0.9; root.add(hips);
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10).scale(0.85, 0.55, 1.2), mat(PANTS)); hips.add(pelvis);
    const spine = this.spine = new THREE.Group(); spine.rotation.z = -0.38; hips.add(spine);   // bent over the ball
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.17, 0.32, 6, 12) : new THREE.CylinderGeometry(0.17, 0.17, 0.62, 12), mat(SHIRT));
    torso.position.y = 0.3; torso.scale.set(0.85, 1, 1.15); spine.add(torso);
    // head: Mii proportions (big round head, simple face)
    const head = new THREE.Group(); head.position.y = 0.78; spine.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), mat(SKIN)); skull.scale.set(0.95, 1.08, 0.95); head.add(skull);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.165, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), mat(HAIR)); hair.position.y = 0.02; head.add(hair);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.168, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.38), mat(CAP)); cap.position.y = 0.035; head.add(cap);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 16, 1, false, -Math.PI / 2, Math.PI), mat(CAP)); brim.position.set(0.12, 0.08, 0); brim.scale.set(1.2, 1, 1.1); head.add(brim);
    const eyeG = new THREE.SphereGeometry(0.022, 10, 8), eyeM = mat('#1c1c1c');
    for (const z of [-0.055, 0.055]){ const e = new THREE.Mesh(eyeG, eyeM); e.position.set(0.145, 0.01, z); e.scale.set(0.5, 1.3, 1); head.add(e); }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), mat('#e8b48c')); nose.position.set(0.16, -0.04, 0); head.add(nose);
    // arms + club swing as one piece from between the shoulders
    const arms = this.arms = new THREE.Group(); arms.position.set(0.05, 0.52, 0); spine.add(arms);
    const armM = mat(SHIRT), handM = mat(SKIN);
    const upL = limb(0.62, 0.05, armM), upR = limb(0.62, 0.05, armM);
    upL.position.set(0, 0, -0.17); upR.position.set(0, 0, 0.17); upL.rotation.x = -0.26; upR.rotation.x = 0.26;
    const hands = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), handM); hands.position.set(0, -0.6, 0); arms.add(upL, upR, hands);
    const club = this.club = new THREE.Group(); club.position.set(0, -0.6, 0); arms.add(club);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.95, 6).translate(0, -0.47, 0), mat('#c9ccd2')); club.add(shaft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.24, 8).translate(0, -0.1, 0), mat('#1d1d1d')); club.add(grip);
    const headM = this.clubHead = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.04), mat('#9aa0a8')); headM.position.set(0.04, -0.95, 0); club.add(headM);
    club.rotation.z = 0.55;   // club angled out toward the ball
    scene.add(root);
    this.anim = null; this.t = 0; this.putter = false;
  }
  place(ballThree, ang, putt){
    const ux = Math.cos(ang), uy = Math.sin(ang), rx = Math.sin(ang), ry = -Math.cos(ang);
    const off = putt ? 0.62 : 0.78;
    // stand on the left side of the ball line, facing it (right-handed)
    this.root.position.set(ballThree.x - rx * off, ballThree.y - 0.02, ballThree.z + ry * off);
    this.root.rotation.y = ang - Math.PI / 2; this.home = this.root.position.clone(); this.ang = ang;
    this.putter = putt; this.setClub(putt);
    if (!this.anim) this.pose(0);
  }
  setClub(putt){ this.clubHead.scale.set(putt ? 0.8 : 1, putt ? 0.7 : 1, putt ? 1.6 : 1); this.club.scale.y = putt ? 0.82 : 1; }
  // p: -1 top of backswing, 0 impact/address, +1 finish
  pose(p){
    const big = this.putter ? 0.32 : 2.5;
    const sw = p < 0 ? p * big : p * (this.putter ? 0.36 : 2.3);
    this.arms.rotation.x = sw;                             // swing arc toward target (-Z) when positive
    this.hips.rotation.y = this.putter ? 0 : -sw * 0.28;   // body turn
    this.spine.rotation.x = this.putter ? 0 : sw * 0.05;
    this.club.rotation.x = this.putter ? 0 : (p < 0 ? p * 1.1 : p * 0.9);   // wrist hinge
  }
  // practice: steps back off the ball (away from the target) and swings at nothing
  swing(onImpact, practice){
    if (this.anim && this.anim.practice && this.home) this.root.position.copy(this.home);
    this.anim = {t: 0, onImpact, hit: false, practice: !!practice};
    if (practice && this.home){ this.root.position.x -= Math.cos(this.ang) * 0.55; this.root.position.z += Math.sin(this.ang) * 0.55; }
  }
  update(dt, time){
    if (!this.anim){ // little waggle while waiting
      this.pose(Math.sin(time * 1.7) * 0.015); return; }
    const a = this.anim; a.t += dt;
    const back = this.putter ? 0.45 : 0.5, down = this.putter ? 0.28 : 0.16, fin = 0.9;
    let p;
    if (a.t < back) p = -Math.sin((a.t / back) * Math.PI / 2);
    else if (a.t < back + down){ const k = (a.t - back) / down; p = -1 + k * k * 1.0; }
    else { if (!a.hit){ a.hit = true; if (a.onImpact) a.onImpact(); } const k = Math.min(1, (a.t - back - down) / fin); p = Math.sin(k * Math.PI / 2); }
    this.pose(p);
    if (a.t > back + down + fin + (a.practice ? 0.2 : 0.6)){ if (a.practice && this.home) this.root.position.copy(this.home); this.anim = null; }
  }
  set visible(v){ this.root.visible = v; }
}
window.GolfGolfer = Golfer;
})();
