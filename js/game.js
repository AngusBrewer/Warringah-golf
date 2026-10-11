// Game flow: holes, shots, scoring, the phone link and the on-screen panels.
(function(){
'use strict';
const VERSION = 9;
const {CLUBS, ORDER, LIE_NAME} = window.GolfPhysics;
const $ = s => document.querySelector(s);
const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angTo = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const fmtM = m => m < 10 ? m.toFixed(1) + ' m' : Math.round(m) + ' m';
// game speed: tests can set window.__golfSpeed to run rounds faster
const SPEED = () => window.__golfSpeed || 1;
function later(fn, ms){ return window.setTimeout(fn, ms / SPEED()); }
function toast(t, ms = 1800){ const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.h); toast.h = window.setTimeout(() => el.classList.remove('show'), ms); }

// ---------- settings shared with the Swing Lab ----------
const CURVE = {off: 0, gentle: 0.5, full: 1};
const settings = {
  get curve(){ const v = store.get('wgolf-curve', 'gentle'); return v in CURVE ? v : 'gentle'; },
  get flip(){ return !!store.get('wgolf-flip2', false); },
  get wind(){ return store.get('wgolf-wind', true); }
};

// ---------- state ----------
let course = null, scene = null, hole = null, holeIdx = 0;
let ball = null, lie = 'tee', strokes = 0, aim = 0, club = 'Dr', windV = [0, 0], pin = [0, 0], reading = false;
let mode = 'menu';          // menu | aim | flight | result | holeEnd | roundEnd
let scores = [], mapView = false, aimHeld = 0, lastPos = null;
const recentFaces = store.get('wgolf-recentface', []);

// ---------- phone link ----------
const ALPH = 'abcdefghjkmnpqrstuvwxyz23456789';
const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ALPH[b % ALPH.length]).join('');
let peer = null, conn = null, tries = 0, phoneOk = false;
function linkChip(t, k){ const c = $('#linkChip'); c.textContent = t; c.className = 'chip' + (k ? ' ' + k : ''); }
function startPeer(id){
  if (typeof Peer === 'undefined'){ linkChip('Link library missing', 'bad'); return; }
  peer = new Peer(id, {debug: 1});
  peer.on('open', pid => { store.set('wgolf-screen-id', pid); showQR(pid); });
  peer.on('connection', c => attach(c));
  peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
  // after switching pages the old connection can hold our id for a few seconds: retry it before picking a new one
  peer.on('error', e => { if (e.type === 'unavailable-id'){ peer.destroy(); tries++; if (tries <= 6) setTimeout(() => startPeer(id), 2000); else startPeer('wgolf-' + rnd(6)); } });
}
function showQR(id){
  const url = new URL('controller.html?v=' + VERSION, location.href).href.split('#')[0] + '#' + id;
  $('#qrLink').textContent = url;
  try { const q = qrcode(0, 'M'); q.addData(url); q.make(); $('#qr').innerHTML = q.createImgTag(5, 0); } catch {}
}
function attach(c){
  if (conn && conn !== c){ try { conn.close(); } catch {} }
  conn = c;
  c.on('open', () => { phoneOk = true; linkChip('Phone linked', 'ok'); $('#pairModal').hidden = true; sendState(); send({t:'club', club}); });
  c.on('data', onPhone);
  c.on('close', () => { if (c !== conn) return; phoneOk = false; linkChip('Phone not linked', 'bad'); });
}
function send(m){ if (conn && conn.open){ try { conn.send(m); } catch {} } }
function onPhone(m){
  if (!m || typeof m !== 'object') return;
  switch (m.t){
    case 'ping': send({t:'pong', at: m.at}); break;
    case 'status': if (Number(m.v) !== VERSION){ linkChip('Phone page out of date: scan again', 'bad'); $('#pairModal').hidden = false; } break;
    case 'club': if (CLUBS[m.club] && mode === 'aim'){ setClub(m.club); } send({t:'club', club}); break;   // echo so the phone shows the club in play
    case 'read': toggleRead(); break;
    case 'aim': aimHeld = m.on ? (m.d < 0 ? 1 : -1) : 0; break;   // ◀ (d = -1) turns the aim left
    case 'view': toggleMap(); break;
    case 'swing': if (!m.cal) onSwing(m); break;
    case 'practice': onPractice(m); break;
    case 'm': meter.fromPhone(Number(m.r) || 0, !!m.h); break;
    case 'cal': if (m.full) cal.full = Number(m.full) || cal.full; if (m.puttFull) cal.putt = Number(m.puttFull) || cal.putt; break;
  }
}

// ---------- course / hole setup ----------
function startRound(id, resume){
  course = new GolfGeo.Course(window.COURSES[id]);
  course.terrain = window.ELEV && ELEV[id] ? new GolfTerrain.Terrain(ELEV[id]) : GolfTerrain.Flat;
  if (!scene){ scene = new GolfScene($('#view'), course); }
  const saved = store.get('wgolf-round', null);
  if (resume && saved && saved.course === id){ scores = saved.scores; holeIdx = saved.hole; }
  else { scores = []; holeIdx = 0; }
  $('#menu').hidden = true; $('#hud').hidden = false;
  if (!phoneOk) $('#pairModal').hidden = false;
  startHole(holeIdx);
}
function saveRound(){ store.set('wgolf-round', {course: course.d.id, hole: holeIdx, scores, at: Date.now()}); }

function startHole(i){
  holeIdx = i; hole = course.d.holes[i]; strokes = 0; lie = 'tee'; mapView = false;
  const r = GolfGeo.rng(1000 + i * 37 + new Date().getDate());
  // pin: a few metres from the green's centre, still on the green
  const g = course.greens[hole.green].a, gc = GolfGeo.centroid(g);
  pin = gc.slice();
  for (let k = 0; k < 12; k++){ const a = r() * Math.PI * 2, d = 2 + r() * 4, p = [gc[0] + Math.cos(a)*d, gc[1] + Math.sin(a)*d];
    if (GolfGeo.pip(p[0], p[1], g) && GolfGeo.edgeDist(p[0], p[1], g) > 3){ pin = p; break; } }
  const wa = r() * Math.PI * 2, ws = settings.wind ? r() * 5 : 0; windV = [Math.cos(wa) * ws, Math.sin(wa) * ws];
  ball = hole.tee.slice(); lastPos = ball.slice();
  scene.setPin(pin[0], pin[1]); scene.setBall(ball[0], ball[1]);
  // hole intro: show the whole hole from above, then drop behind the ball
  const c = [(hole.tee[0] + pin[0]) / 2, (hole.tee[1] + pin[1]) / 2];
  scene.view('map', {center: c, span: Math.max(160, hole.len * 1.05), ang: angTo(hole.tee, pin), snap: true});
  scene.golfer.visible = false; reading = false; scene.showRead(hole.green, false);
  showCard(`Hole ${hole.n}`, `Par ${hole.par} · ${hole.card || hole.len} m · Index ${hole.index || '–'}`, 2400);
  mode = 'intro';
  later(() => { prepareShot(); }, 2400);
  saveRound();
}

function onGreenLie(){ return lie === 'green' || (lie === 'fringe' && dist(ball, pin) < 12); }
function autoClub(){
  if (onGreenLie()) return 'Pt';
  const d = dist(ball, pin) + (course.terrain ? (course.terrain.height(pin[0], pin[1]) - course.terrain.height(ball[0], ball[1])) * 1.1 : 0);
  if (lie === 'tee' && hole.par >= 4) return 'Dr';
  for (let i = ORDER.length - 2; i >= 0; i--){ const k = ORDER[i]; if (CLUBS[k].max * GolfPhysics.lieFactor(lie, k) >= d * 0.97) return k; }
  return lie === 'tee' ? 'Dr' : '3W';
}
// aim at the pin, or along the hole on doglegs when the pin is out of reach
function autoAim(){
  const reach = CLUBS[club].max * GolfPhysics.lieFactor(lie, club);
  if (club === 'Pt' || dist(ball, pin) <= reach * 1.05) return angTo(ball, pin);
  let best = null;
  for (const p of hole.path.slice(1)){
    const dp = dist(ball, p), dpin = dist(p, pin);
    if (dpin < dist(ball, pin) - 10 && dp <= reach * 1.02 && (!best || dpin < dist(best, pin))) best = p;
  }
  return angTo(ball, best || pin);
}
function prepareShot(){
  if (mode === 'roundEnd' || mode === 'menu') return;
  club = autoClub(); aim = autoAim(); mode = 'aim';
  scene.setBall(ball[0], ball[1]); scene.clearTrail(); scene.placeGolfer(ball, aim, club === 'Pt'); meter.reset();
  reading = false; scene.showRead(hole.green, false);
  setView();
  updateHUD();
  send({t:'club', club});
  sendState();
}
function setView(){
  if (mapView){
    const c = [(ball[0] + pin[0]) / 2, (ball[1] + pin[1]) / 2];
    scene.view('map', {center: c, span: Math.max(80, dist(ball, pin) * 1.3), ang: aim});
  } else scene.view('address', {ball, ang: aim, putt: club === 'Pt', toPin: dist(ball, pin)});
}
function toggleMap(){ if (mode !== 'aim') return; mapView = !mapView; setView(); }
// any club from any lie, including the putter from the fringe or rough
function setClub(k){ if (!CLUBS[k]) return; const wasPutt = club === 'Pt'; club = k; if (wasPutt !== (k === 'Pt')){ aim = angTo(ball, k === 'Pt' ? pin : pin); scene.placeGolfer(ball, aim, k === 'Pt'); setView(); } updateHUD(); }
// Wii-style green read: coloured grid with downhill arrows on the green you're putting to
function toggleRead(){ if (mode !== 'aim' && mode !== 'intro') return; reading = !reading; scene.showRead(hole.green, reading); $('#readBtn').classList.toggle('on', reading); if (reading && !mapView && club !== 'Pt') toggleMap(); }
function sendState(){
  if (!hole) return;
  const txt = mode === 'aim' ? `Hole ${hole.n} · Par ${hole.par} · ${fmtM(dist(ball, pin))} to the pin · ${LIE_NAME[lie]}` : `Hole ${hole.n}`;
  send({t:'state', text: txt, mode, club});
}

// ---------- swings ----------
function faceToSide(face, putt){
  const k = CURVE[settings.curve]; if (!k) return 0;
  let f = Number(face) || 0;
  // treat your usual swing as straight: subtract the median of your recent swings
  if (!putt && recentFaces.length >= 3){ const s = [...recentFaces].sort((a,b) => a-b); f -= s[s.length >> 1]; }
  if (settings.flip) f = -f;
  if (putt) return Math.max(-6, Math.min(6, f * 0.25)) * k;   // degrees of aim error
  const eff = Math.sign(f) * Math.max(0, Math.abs(f) - 7);        // ignore the first 7° either way
  return eff * k * 1.2;
}
function onSwing(m){
  if (mode !== 'aim') return;
  const putting = club === 'Pt';
  const power = Math.max(0.02, Math.min(1, Number(m.power) || 0));
  meter.final(m.over ? 1.2 : power); if (m.over && !putting) meter.crazy();
  const face = Number(m.face) || 0;
  if (!putting && !m.putt){ recentFaces.push(face); while (recentFaces.length > 8) recentFaces.shift(); store.set('wgolf-recentface', recentFaces); }
  takeShot(power, faceToSide(face, putting), !!m.over);
}
// a swing made without holding the pad: the golfer rehearses off the ball and the bar shows how it went
function onPractice(m){
  if (mode !== 'aim') return;
  const putting = club === 'Pt', power = Math.max(0.02, Math.min(1, Number(m.power) || 0)), over = !!m.over && !putting;
  meter.final(over ? 1.2 : power); if (over) meter.crazy();
  const fs = faceToSide(Number(m.face) || 0, putting), C = CLUBS[club];
  let shape;
  if (over) shape = 'overswing, could go anywhere';
  else if (putting) shape = Math.abs(fs) < 1 ? 'on line' : fs > 0 ? 'pushed right' : 'pulled left';
  else { const side = fs * 0.9 * C.curve * (C.max * power / 100); shape = Math.abs(side) < 3 ? 'straight' : Math.abs(side) < 10 ? (side > 0 ? 'slight fade' : 'slight draw') : (side > 0 ? 'slice' : 'hook'); }
  const carry = putting ? 20 * power : C.max * Math.pow(power, 0.9) * GolfPhysics.lieFactor(lie, club);
  toast(`Practice ${putting ? 'putt' : 'swing'}: ${Math.round(power * 100)}% (about ${fmtM(carry)}), ${shape}`, 2600);
  if (!scene.golfer.anim) scene.golfer.swing(null, true);
}
function greenField(p){ return scene.greenAt(p[0], p[1]) || scene.fields[hole.green]; }
function takeShot(power, faceSide, over){
  strokes++; lastPos = ball.slice(); mode = 'flight'; scene.showAim(ball, 0, 0); updateHUD(); sendState();
  reading = false; scene.showRead(hole.green, false); scene.clearTrail();
  // the golfer swings; the ball leaves at impact
  scene.golfer.setClub(club === 'Pt'); scene.golfer.putter = club === 'Pt';
  scene.golfer.swing(() => launch(power, faceSide, over));
}
function launch(power, faceSide, over){
  if (club === 'Pt'){
    const r = GolfPhysics.putt(course, {from: ball, ang: aim - faceSide * Math.PI / 180, power, pin, field: greenField(ball)});   // + face pushes it right
    animatePutt(r);
    return;
  }
  const C = CLUBS[club];
  let side = faceSide * 0.9 * C.curve * (C.max * power / 100);
  // overswing: the bar goes haywire and it's a coin flip whether it slices right or hooks left
  if (over){ const dir = Math.random() < 0.5 ? -1 : 1; side = dir * (0.1 + Math.random() * 0.07) * C.max * power * Math.max(0.5, C.curve); banner(dir > 0 ? 'Overswing! Big slice.' : 'Overswing! Big hook.'); }
  const r = GolfPhysics.fullShot(course, {from: ball, ang: aim, club, power, lie, wind: windV, side, pin});
  animateFlight(r);
}

// ---------- animation ----------
let anim = null;
function animateFlight(r){
  const dur = 1.6 + r.carry / 110, rollDur = Math.min(2.5, 0.4 + r.rollTrack.length * 0.012);
  anim = {kind: 'flight', r, t0: performance.now(), dur, rollDur};
}
function startDrop(prev, done){
  const dx = pin[0] - prev[0], dy = pin[1] - prev[1], L = Math.hypot(dx, dy) || 1, R = GolfPhysics.CUP * 0.45;
  const from = [pin[0] - dx / L * GolfPhysics.CUP * 0.9, pin[1] - dy / L * GolfPhysics.CUP * 0.9], to = [pin[0] + dx / L * R + dy / L * 0.03, pin[1] + dy / L * R - dx / L * 0.03];
  anim = {kind: 'drop', from, to, done, t0: performance.now()};
}
function animatePutt(r){ anim = {kind: 'putt', r, t0: performance.now(), dur: Math.min(6, 0.6 + r.track.length * 0.05)}; }
function stepAnim(now){
  if (!anim) return;
  const t = Math.max(0, (now - anim.t0) / 1000 * SPEED());   // rAF time can be slightly older than t0
  if (anim.kind === 'flight'){
    const {r, dur, rollDur} = anim, S = r.samples;
    if (t < dur){
      const f = t / dur, idx = f * (S.length - 1), i = Math.floor(idx), k = idx - i, a = S[i], b = S[Math.min(S.length - 1, i + 1)];
      const p = [a[0] + (b[0]-a[0])*k, a[1] + (b[1]-a[1])*k, a[2] + (b[2]-a[2])*k];
      scene.setBall(p[0], p[1], p[2], true); scene.view('follow', {ball: p, ang: aim, h: p[2]});
      return;
    }
    const rt = t - dur, R = r.rollTrack;
    if (rt < rollDur && R.length > 1){
      const f = 1 - Math.pow(1 - rt / rollDur, 2), p = R[Math.min(R.length - 1, Math.floor(f * (R.length - 1)))];
      scene.setBall(p[0], p[1]); scene.view('watch', {ball: p}); return;
    }
    if (r.holed) return startDrop(R.length > 1 ? R[R.length - 2] : ball, () => finishShot(r.rest, r.lie, r.holed, [], r.events));
    anim = null; finishShot(r.rest, r.lie, r.holed, r.samples.concat(r.rollTrack.map(p => [p[0], p[1], 0])), r.events);
  } else if (anim.kind === 'putt'){
    const {r, dur} = anim, T = r.track;
    if (t < dur){ const f = 1 - Math.pow(1 - t / dur, 2.2), p = T[Math.min(T.length - 1, Math.floor(f * (T.length - 1)))];
      scene.setBall(p[0], p[1]); scene.view('address', {ball: [p[0] - Math.cos(aim)*0.01, p[1] - Math.sin(aim)*0.01], ang: aim, putt: true, toPin: dist(p, pin)}); return; }
    if (r.holed) return startDrop(T.length > 2 ? T[T.length - 3] : ball, () => finishShot(r.rest, r.lie, r.holed, [], []));
    anim = null; finishShot(r.rest, r.lie, r.holed, T.map(p => [p[0], p[1], 0]), r.lip ? ['lip'] : []);
  } else if (anim.kind === 'drop'){
    // roll over the lip toward the far side of the cup, then fall to the bottom
    const {from, to, done} = anim, k = Math.min(1, t / 0.42), e = k * k;
    const x = from[0] + (to[0] - from[0]) * Math.min(1, k * 1.6), y = from[1] + (to[1] - from[1]) * Math.min(1, k * 1.6);
    scene.setBall(x, y, -0.105 * e);
    if (k >= 1){ anim = null; done(); }
  }
}

function finishShot(rest, newLie, holed, track, events){
  mode = 'result';
  if (holed){ ball = pin.slice(); return holeOut(); }   // the ball stays at the bottom of the cup
  let msg = '';
  if (newLie === 'ob'){ strokes++; ball = lastPos.slice(); lie = course.lie(ball[0], ball[1]); msg = 'Out of bounds. One-stroke penalty, play again.'; }
  else if (newLie === 'water'){ strokes++; ball = GolfPhysics.dropPoint(course, track, lastPos); lie = course.lie(ball[0], ball[1]); if (lie === 'water' || lie === 'ob'){ ball = lastPos.slice(); lie = course.lie(ball[0], ball[1]); } msg = 'In the water. One-stroke penalty, dropping out.'; }
  else { ball = rest; lie = newLie; }
  if (!msg){
    const d = dist(ball, pin);
    if (events.includes('tree')) msg = 'Hit a tree! ';
    else if (events.includes('lip')) msg = 'Lipped out! ';
    msg += lie === 'green' ? `On the green, ${fmtM(d)} away.` : lie === 'bunker' ? 'In the bunker.' : lie === 'rough' ? `In the rough, ${fmtM(d)} to go.` : lie === 'fringe' ? `On the fringe, ${fmtM(d)}.` : `${LIE_NAME[lie]}, ${fmtM(d)} to go.`;
    if (club === 'Pt' && d < 0.35){ msg = 'Tap-in.'; strokes++; ball = pin.slice(); scene.setBall(ball[0], ball[1]); banner(msg); return later(holeOut, 900); }
  }
  if (strokes >= 10){ banner('Picking up. That one is a 10.'); strokes = 10; return later(holeOut, 1500); }
  banner(msg); updateHUD();
  later(prepareShot, 1500);
}
const NAMES = {'-3':'Albatross!', '-2':'Eagle!', '-1':'Birdie!', '0':'Par', '1':'Bogey', '2':'Double bogey', '3':'Triple bogey'};
function holeOut(){
  mode = 'holeEnd';
  scores[holeIdx] = strokes; saveRound();
  const diff = strokes - hole.par;
  const name = strokes === 1 ? 'Hole in one!' : NAMES[diff] || (diff > 0 ? `+${diff}` : `${diff}`);
  showCard(name, `${strokes} ${strokes === 1 ? 'stroke' : 'strokes'} on hole ${hole.n}`, 2600);
  updateHUD(); send({t:'state', text: `${name} ${strokes} on hole ${hole.n}`, mode});
  later(() => {
    if (holeIdx + 1 < course.d.holes.length) startHole(holeIdx + 1);
    else { mode = 'roundEnd'; showScorecard(true); store.set('wgolf-round', null); }
  }, 2800);
}

// ---------- swing bar (Wii style) ----------
// Fills live from the phone's rotation speed while you hold the pad; 100% is your full swing from the Swing Lab.
const cal = {full: 1100, putt: 300};
const meter = {
  peak: 0, held: false, shown: 0, hideT: 0,
  scale(p){ return Math.max(0, Math.min(1.3, p)) / 1.3 * 100; },
  draw(p, final){ const el = $('#meter'); el.classList.toggle('done', !!final);
    $('#mFill').style.height = this.scale(p) + '%'; $('#mLab').textContent = Math.round(p * 100) + '%';
    $('#mPeak').style.bottom = this.scale(this.peak) + '%'; $('#mPeak').style.opacity = this.peak > 0.05 ? 1 : 0;
    $('#mLab').style.color = p > 1.15 ? '#b3372b' : ''; },
  reset(){ this.peak = 0; this.draw(0); },
  live(p){ this.peak = Math.max(this.peak, p); this.draw(p); if (p > 1.15 && club !== 'Pt' && !$('#meter').classList.contains('crazy')) this.crazy(); },
  fromPhone(r, held){
    if (mode !== 'aim') return;
    if (held && !this.held) this.peak = 0;
    this.held = held;
    const putt = club === 'Pt', chip = ['9i', 'PW', 'SW'].includes(club);
    const floor = putt ? 30 : chip ? 60 : 150, top = putt ? cal.putt : cal.full;
    // fills while holding (a real swing) and also for practice swings without holding
    const p = Math.max(0, (r - floor) / (top - floor));
    if (held || p > 0.02){ if (!this.live_ || performance.now() - this.lastLive > 900) this.peak = 0; this.live_ = true; this.lastLive = performance.now(); this.live(p); }
  },
  final(p){ this.peak = Math.max(this.peak, p); this.draw(p, true); },
  crazy(){ const el = $('#meter'); el.classList.remove('crazy'); void el.offsetWidth; el.classList.add('crazy'); clearTimeout(this.cz); this.cz = window.setTimeout(() => el.classList.remove('crazy'), 1600); },
  pinTick(){   // where the bar needs to reach to get to the pin
    const t = $('#mPin'); if (!hole || mode !== 'aim'){ t.style.display = 'none'; return; }
    const C = CLUBS[club], d = playsLike();
    const need = C.putt ? d / 20 : Math.pow(Math.min(1.3, d / (C.max * GolfPhysics.lieFactor(lie, club))), 1 / 0.9);
    t.style.display = need <= 1.3 ? 'block' : 'none'; t.style.bottom = this.scale(need) + '%';
  }
};
// distance adjusted for height: uphill plays longer, downhill shorter
function playsLike(){ const d = dist(ball, pin); if (!course.terrain || club === 'Pt') return d; return d + (course.terrain.height(pin[0], pin[1]) - course.terrain.height(ball[0], ball[1])) * 1.1; }

// ---------- HUD ----------
function banner(t){ const b = $('#banner'); b.textContent = t; b.classList.add('show'); clearTimeout(banner.h); banner.h = window.setTimeout(() => b.classList.remove('show'), 2600); }
function showCard(a, b, ms){ $('#cardA').textContent = a; $('#cardB').textContent = b; const c = $('#holeCard'); c.classList.add('show'); clearTimeout(showCard.h); showCard.h = window.setTimeout(() => c.classList.remove('show'), ms); }
function totals(){ let s = 0, p = 0; course.d.holes.forEach((h, i) => { if (scores[i] != null){ s += scores[i]; p += h.par; } }); return {s, p}; }
function updateHUD(){
  if (!hole) return;
  const C = CLUBS[club], d = dist(ball, pin);
  $('#hHole').textContent = hole.n; $('#hPar').textContent = `Par ${hole.par} · ${hole.card || hole.len} m`;
  $('#hStroke').textContent = mode === 'aim' ? `Shot ${strokes + 1}` : `Shot ${strokes}`;
  const t = totals(), tp = t.s - t.p; $('#hTotal').textContent = t.p ? (tp === 0 ? 'E' : tp > 0 ? '+' + tp : tp) : 'E';
  $('#hPin').textContent = fmtM(d); $('#hLie').textContent = LIE_NAME[lie] || lie;
  const pl = playsLike(); $('#playsRow').hidden = Math.abs(pl - d) < 2 || club === 'Pt'; $('#hPlays').textContent = `${fmtM(pl)} ${pl > d ? 'uphill' : 'downhill'}`;
  meter.pinTick();
  $('#hClub').textContent = C.name;
  $('#hClubMax').textContent = C.putt ? 'Up to 20 m' : `Up to ${Math.round(C.max * GolfPhysics.lieFactor(lie, club))} m`;
  const ws = Math.hypot(windV[0], windV[1]);
  $('#hWind').textContent = ws < 0.3 ? 'Calm' : `${ws.toFixed(1)} m/s`;
  $('#windArrow').style.transform = `rotate(${(aim - Math.atan2(windV[1], windV[0])) * 180 / Math.PI}deg)`;
  $('#windArrow').style.opacity = ws < 0.3 ? 0.25 : 1;
  if (mode === 'aim'){
    const reach = C.putt ? Math.min(d, 20) : C.max * GolfPhysics.lieFactor(lie, club);
    scene.showAim(ball, aim, C.putt ? Math.min(d + 0.5, 20) : Math.min(reach, Math.max(reach * 0.5, d)), C.putt);
  }
  $('#hint').textContent = mode === 'aim' ? (phoneOk ? (C.putt ? 'Hold the pad and putt. Putt without holding to practise.' : 'Hold the pad and swing. Swing without holding to practise.') : 'Link your phone, or hold Space to swing.') : '';
  drawMini();
}
function showScorecard(final){
  const holes = course.d.holes;
  const row = (label, f, cls = '') => `<tr class="${cls}"><th>${label}</th>${holes.map((h, i) => `<td class="${f.cls ? f.cls(h, i) : ''}"><span>${f(h, i)}</span></td>`).join('')}</tr>`;
  const sc = (h, i) => scores[i] == null ? '' : scores[i];
  sc.cls = (h, i) => scores[i] == null ? '' : scores[i] < h.par ? 'under' : scores[i] > h.par ? 'over' : 'par';
  const t = totals(), tp = t.s - t.p;
  $('#scoreTable').innerHTML = `<table>${row('Hole', h => h.n)}${row('Metres', h => h.len, 'dim')}${row('Par', h => h.par)}${row('Score', sc)}</table>`;
  $('#scoreSum').textContent = t.p ? `${t.s} strokes, ${tp === 0 ? 'level par' : tp > 0 ? tp + ' over par' : -tp + ' under par'}` : 'No holes finished yet.';
  $('#scoreTitle').textContent = final ? 'Round complete' : 'Scorecard';
  $('#scoreNew').hidden = !final;
  $('#scoreModal').hidden = false;
}

// ---------- mini map ----------
function drawMini(){
  const cv = $('#mini'), g = cv.getContext('2d'), w = cv.width, h = cv.height;
  g.clearRect(0, 0, w, h);
  if (!hole || !scene) return;
  // rotate so the hole plays bottom to top
  const a = angTo(hole.tee, pin), pts = [hole.tee, pin, ...hole.path, ball];
  const rot = p => { const dx = p[0] - hole.tee[0], dy = p[1] - hole.tee[1], c = Math.cos(Math.PI/2 - a), s = Math.sin(Math.PI/2 - a); return [dx*c - dy*s, dx*s + dy*c]; };
  const R = pts.map(rot); let x0 = Math.min(...R.map(p => p[0])) - 35, x1 = Math.max(...R.map(p => p[0])) + 35, y0 = Math.min(...R.map(p => p[1])) - 25, y1 = Math.max(...R.map(p => p[1])) + 25;
  const sc = Math.min(w / (x1 - x0), h / (y1 - y0)), ox = (w - (x1 - x0) * sc) / 2, oy = (h - (y1 - y0) * sc) / 2;
  const T = p => { const q = rot(p); return [ox + (q[0] - x0) * sc, h - (oy + (q[1] - y0) * sc)]; };
  g.save();
  g.fillStyle = '#4f8f3a'; g.fillRect(0, 0, w, h);
  const poly = (a, fill) => { g.beginPath(); for (let i = 0; i < a.length; i += 2){ const p = T([a[i], a[i+1]]); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); } g.closePath(); g.fillStyle = fill; g.fill(); };
  const d = course.d;
  d.fairways.forEach(f => poly(f, '#7cc04a')); d.tees.forEach(f => poly(f, '#83c652'));
  d.greens.forEach(f => poly(f, '#9be067')); d.bunkers.forEach(f => poly(f, '#ead9a6')); d.water.forEach(f => poly(f, '#3f86c6'));
  g.strokeStyle = '#3f86c6'; g.lineWidth = Math.max(2, 4.5 * sc);
  d.creeks.forEach(c => { g.beginPath(); for (let i = 0; i < c.length; i += 2){ const p = T([c[i], c[i+1]]); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); } g.stroke(); });
  g.fillStyle = '#2c5e2a'; const near = course.trees.filter(t => dist([t.x, t.y], ball) < 700);
  near.forEach(t => { const p = T([t.x, t.y]); g.beginPath(); g.arc(p[0], p[1], Math.max(1.2, t.r * sc), 0, Math.PI * 2); g.fill(); });
  // aim line
  if (mode === 'aim'){ const C = CLUBS[club], L = C.putt ? Math.min(20, dist(ball, pin) + 0.5) : C.max * GolfPhysics.lieFactor(lie, club);
    const b = T(ball), e = T([ball[0] + Math.cos(aim) * L, ball[1] + Math.sin(aim) * L]);
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.setLineDash([4, 4]); g.lineWidth = 2; g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(e[0], e[1]); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#ffe066'; g.lineWidth = 2; g.beginPath(); g.arc(e[0], e[1], 6, 0, Math.PI * 2); g.stroke(); }
  const fp = T(pin); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(fp[0], fp[1]); g.lineTo(fp[0], fp[1] - 14); g.stroke();
  g.fillStyle = '#e23b2e'; g.beginPath(); g.moveTo(fp[0], fp[1] - 14); g.lineTo(fp[0] + 9, fp[1] - 11); g.lineTo(fp[0], fp[1] - 8); g.fill();
  const bp = T(ball); g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 1.5; g.beginPath(); g.arc(bp[0], bp[1], 4, 0, Math.PI * 2); g.fill(); g.stroke();
  g.restore();
}

// ---------- input: keyboard fallback ----------
let spaceDown = 0;
window.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  if (e.key === 'ArrowLeft') aimHeld = 1;            // left on screen = anticlockwise
  else if (e.key === 'ArrowRight') aimHeld = -1;
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown'){ if (mode !== 'aim') return; const i = ORDER.indexOf(club) + (e.key === 'ArrowUp' ? -1 : 1); if (i >= 0 && i < ORDER.length){ setClub(ORDER[i]); send({t:'club', club}); } e.preventDefault(); }
  else if (e.key === 'g' || e.key === 'G') toggleRead();
  else if (e.key === 'm' || e.key === 'M') toggleMap();
  else if (e.key === 's' || e.key === 'S'){ if (course) showScorecard(false); }
  else if (e.key === ' '){ if (!spaceDown && mode === 'aim'){ spaceDown = performance.now(); meter.reset(); } e.preventDefault(); }
});
window.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') aimHeld = 0;
  if (e.key === ' ' && spaceDown){ const p = Math.min(1, (performance.now() - spaceDown) / 1200); spaceDown = 0; if (mode === 'aim'){ meter.final(p); takeShot(p, 0, false); } }
});
function stepAim(dt){
  if (!aimHeld || mode !== 'aim') return;
  const rate = club === 'Pt' ? 0.18 : 0.35;   // radians per second
  aim += (aimHeld > 0 ? 1 : -1) * rate * dt;    // +1 = left (anticlockwise seen from above)
  setView(); updateHUD();
}

// ---------- main loop ----------
let lastT = performance.now();
function loop(now){
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (scene){ stepAnim(now); stepAim(dt); scene.frame(dt * SPEED(), now / 1000); }
  if (spaceDown){ meter.live(Math.min(1, (now - spaceDown) / 1200)); }
  requestAnimationFrame(loop);
}

// ---------- menu ----------
function initMenu(){
  const saved = store.get('wgolf-round', null);
  $('#resumeBtn').hidden = !(saved && saved.course === 'warringah' && saved.hole > 0);
  if (saved && saved.hole > 0) $('#resumeBtn').textContent = `Resume Warringah from hole ${saved.hole + 1}`;
  $('#playBtn').onclick = () => startRound('warringah', false);
  $('#resumeBtn').onclick = () => startRound('warringah', true);
  $('#menuBtn').onclick = () => { $('#menu').hidden = false; $('#hud').hidden = true; mode = 'menu'; initMenu(); };
  $('#cardBtn').onclick = () => showScorecard(false);
  $('#scoreClose').onclick = () => { $('#scoreModal').hidden = true; };
  $('#scoreNew').onclick = () => { $('#scoreModal').hidden = true; startRound('warringah', false); };
  $('#pairBtn').onclick = () => { $('#pairModal').hidden = false; };
  $('#pairClose').onclick = () => { $('#pairModal').hidden = true; };
  $('#mapBtn').onclick = toggleMap; $('#readBtn').onclick = toggleRead;
  const cs = $('#curveSel'); cs.value = settings.curve; cs.onchange = () => store.set('wgolf-curve', cs.value);
  const wc = $('#windChk'); wc.checked = settings.wind; wc.onchange = () => store.set('wgolf-wind', wc.checked);
  $('#ver').textContent = 'Version ' + VERSION;
}
window.addEventListener('resize', () => { if (scene) scene.resize(); });
initMenu();
startPeer(store.get('wgolf-screen-id', null) || ('wgolf-' + rnd(6)));
requestAnimationFrame(loop);
// for automated tests
window.__golf = {get mode(){ return mode; }, get ball(){ return ball; }, get pin(){ return pin; }, get strokes(){ return strokes; }, get scores(){ return scores; }, get hole(){ return holeIdx; }, get club(){ return club; }, get lie(){ return lie; }, get course(){ return course; }, get scene(){ return scene; }, takeShot: (p, f) => takeShot(p, f || 0, false), startRound};
})();
