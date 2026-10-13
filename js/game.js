// Game flow: holes, shots, scoring, the phone link and the on-screen panels.
(function(){
'use strict';
const VERSION = 14;
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
  get wind(){ return store.get('wgolf-wind2', true); },
  get difficulty(){ const v = store.get('wgolf-difficulty', 'beginner'); return GolfPhysics.DIFFICULTY[v] ? v : 'beginner'; }   // new players start on Beginner
};
GolfPhysics.setDifficulty(settings.difficulty);

// ---------- state ----------
let course = null, scene = null, hole = null, holeIdx = 0;
let ball = null, lie = 'tee', strokes = 0, aim = 0, club = 'Dr', windV = [0, 0], pin = [0, 0], reading = false;
let mode = 'menu';          // menu | aim | flight | result | holeEnd | roundEnd
let scores = [], mapView = false, aimHeld = 0, lastPos = null;
let roundHoles = [], roundName = '18 holes';     // which of the course's holes this round plays
let spin = {top: 0, side: 0};                    // where you strike the ball: top/back spin and side spin
const recentFaces = store.get('wgolf-recentface', []);
// ---- players: one or two, each with their own phone, ball and scorecard ----
const PCOL = ['#2e7fd6', '#e0602a'];
let nPlayers = Math.max(1, Math.min(2, store.get('wgolf-players', 1)));
let players = [], cur = 0;
function newPlayer(i){ return {i, name: 'Player ' + (i + 1), color: PCOL[i], ball: null, lie: 'tee', strokes: 0, scores: [], lastPos: null, done: false, cal: {full: 1100, putt: 300}, faces: i === 0 ? recentFaces.slice() : []}; }
// the current player's values live in the usual variables; these move them in and out
function savePlayer(){ const p = players[cur]; if (!p) return; Object.assign(p, {ball, lie, strokes, scores, lastPos}); p.cal = {...cal}; p.faces = recentFaces.slice(); }
function loadPlayer(i){ cur = i; const p = players[i]; ({ball, lie, strokes, scores, lastPos} = p); cal.full = p.cal.full; cal.putt = p.cal.putt; recentFaces.length = 0; recentFaces.push(...p.faces); phoneOk = phones[i].ok; }

// ---------- phone link ----------
const ALPH = 'abcdefghjkmnpqrstuvwxyz23456789';
const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ALPH[b % ALPH.length]).join('');
let peer = null, tries = 0, phoneOk = false, qrImg = '';
const phones = [{conn: null, ok: false, last: 0}, {conn: null, ok: false, last: 0}];   // one per player
function linkChip(t, k){ const c = $('#linkChip'); $('#linkTxt').textContent = t; c.className = 'chip' + (k ? ' ' + k : ''); pairStatus(); }
// live link light: green and pulsing while swing data is arriving from the phone
function pairStatus(){
  const now = performance.now(), live = i => phones[i].ok && now - phones[i].last < 1500;
  const anyLive = [0, 1].slice(0, nPlayers).some(live);
  for (const id of ['#liveDot', '#pairDot', '#gDot']){ const d = $(id); if (d) d.classList.toggle('on', id === '#liveDot' ? live(cur) : anyLive); }
  const one = i => !phones[i].ok ? 'waiting… scan the code, then tap Start' : live(i) ? 'linked and sending swings ✓' : 'linked: tap Start on the phone and allow motion';
  const t = nPlayers === 2 ? `Player 1: ${one(0)}. Player 2: ${one(1)}.`
    : !phones[0].ok ? 'Waiting for your phone… scan the code, then tap Start.' : live(0) ? 'Phone linked and sending your swing. You\'re ready.' : 'Phone linked. On the phone, tap Start and allow motion.';
  for (const id of ['#pairTxt', '#gTxt']){ const e = $(id); if (e) e.textContent = t; }
  if ($('#gNext') && guide.step === 1) $('#gNext').disabled = !phones[0].ok;
}
setInterval(pairStatus, 700);
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
  try { const q = qrcode(0, 'M'); q.addData(url); q.make(); qrImg = q.createImgTag(5, 0); $('#qr').innerHTML = qrImg; const g = $('#gQr'); if (g) g.innerHTML = qrImg; } catch {}
}
// Each phone that links takes the next free player slot (with one player, a new phone replaces the old).
function attach(c){
  const free = i => !(phones[i].conn && phones[i].conn.open && phones[i].conn !== c);
  const want = c.metadata && Number.isInteger(c.metadata.slot) ? c.metadata.slot : -1;   // a phone coming back asks for its old slot
  let k = want >= 0 && want < nPlayers && free(want) ? want : [0, 1].slice(0, nPlayers).find(free);
  if (k == null) k = nPlayers - 1;
  const old = phones[k].conn; if (old && old !== c){ try { old.close(); } catch {} }
  phones[k].conn = c;
  c.on('open', () => { phones[k].ok = true; if (k === cur) phoneOk = true; linkLabel(); sendTo(k, {t:'you', n: k + 1, of: nPlayers, color: PCOL[k]}); if (k === cur){ sendState(); sendTo(k, {t:'club', club}); } else if (players[cur] && hole) sendTo(k, {t:'state', text: `${players[cur].name} is playing. Wait for your turn.`, mode: 'wait'});
    if (!$('#pairModal').hidden && [0, 1].slice(0, nPlayers).every(i => phones[i].ok)) window.setTimeout(() => { $('#pairModal').hidden = true; }, 2500); });
  c.on('data', m => onPhone(m, k));
  c.on('close', () => { if (c !== phones[k].conn) return; phones[k].ok = false; if (k === cur) phoneOk = false; linkLabel(); });
}
function pairText(){
  const li = $('#pairLi1'); if (li) li.innerHTML = nPlayers === 2 ? 'Two players: <b>each</b> scan this code with your own phone and open the link. The first phone is Player 1.' : "Scan this code with your phone's camera and open the link.";
  const h = $('#pairModal h2'); if (h) h.textContent = nPlayers === 2 ? 'Link both phones' : 'Link your phone';
}
function linkLabel(){
  if (nPlayers === 1) return phones[0].ok ? linkChip('Linked', 'ok') : linkChip('Phone not linked', 'bad');
  const all = phones[0].ok && phones[1].ok; linkChip(`P1 ${phones[0].ok ? '✓' : '…'}  P2 ${phones[1].ok ? '✓' : '…'}`, all ? 'ok' : 'bad');
}
function sendTo(i, m){ const c = phones[i] && phones[i].conn; if (c && c.open){ try { c.send(m); } catch {} } }
function send(m){ sendTo(cur, m); }
function onPhone(m, k = 0){
  if (!m || typeof m !== 'object') return;
  if (m.t === 'm'){ phones[k].last = performance.now(); if (k === cur) meter.fromPhone(Number(m.r) || 0, !!m.h); return; }
  if (m.t === 'ping'){ sendTo(k, {t:'pong', at: m.at}); return; }
  if (m.t === 'status'){ if (Number(m.v) !== VERSION){ linkChip('Phone page out of date: scan again', 'bad'); $('#pairModal').hidden = false; } return; }
  if (m.t === 'cal'){ if (k === 0) guide.onCal(m); const pc = players[k] ? players[k].cal : null;
    for (const c of [pc, k === cur ? cal : null]) if (c){ if (m.full) c.full = Number(m.full) || c.full; if (m.puttFull) c.putt = Number(m.puttFull) || c.putt; } return; }
  // only the player whose turn it is can swing, aim or change club
  if (k !== cur){ if (m.t === 'swing' && !m.cal) sendTo(k, {t:'state', text: `${players[cur] ? players[cur].name : 'Player ' + (cur + 1)} is playing. Wait for your turn.`}); return; }
  switch (m.t){
    case 'club': if (CLUBS[m.club] && mode === 'aim'){ setClub(m.club); } send({t:'club', club}); break;   // echo so the phone shows the club in play
    case 'read': toggleRead(); break;
    case 'aim': aimHeld = m.on ? (m.d < 0 ? 1 : -1) : 0; break;   // ◀ (d = -1) turns the aim left
    case 'view': toggleMap(); break;
    case 'swing': if (!m.cal) onSwing(m); break;
    case 'spin': setSpin(Number(m.top) || 0, Number(m.side) || 0, true); break;
  }
}

// ---------- course / hole setup ----------
// spec: 'all' | 'front' | 'back' | 'quick3' | a hole number (single hole)
function holesFor(spec, n){
  const all = Array.from({length: n}, (_, i) => i);
  if (spec === 'front') return all.slice(0, Math.min(9, n));
  if (spec === 'back') return n > 9 ? all.slice(9) : all;
  if (spec === 'quick3') return all.slice(0, Math.min(3, n));
  if (typeof spec === 'number' || /^\d+$/.test(spec)){ const k = Math.max(1, Math.min(n, Number(spec))) - 1; return [k]; }
  return all;
}
function roundLabel(spec){ return spec === 'front' ? 'Front 9' : spec === 'back' ? 'Back 9' : spec === 'quick3' ? '3 holes' : (typeof spec === 'number' || /^\d+$/.test(spec)) ? `Hole ${spec}` : '18 holes'; }
function startRound(id, resume, spec = 'all'){
  if (!store.get('wgolf-onboarded', false) && !guide.open){ guide.show(0, {id, resume, spec}); return; }
  if (scene && scene.course.d.id !== id){ try { sessionStorage.setItem('wgolf-start', JSON.stringify({id, resume, spec})); } catch {} location.reload(); return; }
  GolfSound.unlock();
  // the aerial photo for the ground: load it first (a few MB), then carry on
  const ph = window.COURSES[id].photo;
  if (ph && !ph.img){
    const im = new Image(); ph.img = 'loading'; toast('Loading the course…', 6000);
    im.onload = () => { ph.img = im; startRound(id, resume, spec); };
    im.onerror = () => { ph.img = 'failed'; startRound(id, resume, spec); };
    im.src = ph.src + '?v=' + VERSION; return;
  }
  if (ph && ph.img === 'loading') return;
  course = new GolfGeo.Course(window.COURSES[id]);
  course.terrain = window.ELEV && ELEV[id] ? new GolfTerrain.Terrain(ELEV[id]) : GolfTerrain.Flat;
  if (!scene){ scene = new GolfScene($('#view'), course); }
  const saved = store.get('wgolf-round', null);
  let first;
  if (resume && saved && saved.course === id){
    nPlayers = saved.players ? saved.players.length : 1; players = Array.from({length: nPlayers}, (_, i) => newPlayer(i));
    players.forEach((p, i) => { p.scores = saved.players ? saved.players[i] : saved.scores; });
    roundHoles = saved.holes || holesFor('all', course.d.holes.length); roundName = saved.name || '18 holes'; first = saved.hole;
  } else { players = Array.from({length: nPlayers}, (_, i) => newPlayer(i)); roundHoles = holesFor(spec, course.d.holes.length); roundName = roundLabel(spec); first = roundHoles[0]; }
  players.forEach((p, i) => { p.cal = i === cur ? {...cal} : p.cal; });
  loadPlayer(0); pairText(); linkLabel();
  $('#menu').hidden = true; $('#hud').hidden = false;
  if ((!phones[0].ok || (nPlayers === 2 && !phones[1].ok)) && !store.get('wgolf-keyboard', false)) $('#pairModal').hidden = false;
  startHole(first);
}
function saveRound(){ savePlayer(); store.set('wgolf-round', {course: course.d.id, hole: holeIdx, scores: players[0].scores, players: players.map(p => p.scores), holes: roundHoles, name: roundName, at: Date.now()}); }

function startHole(i){
  holeIdx = i; hole = course.d.holes[i]; mapView = false;
  savePlayer();
  const prev = roundHoles[roundHoles.indexOf(i) - 1];
  players.forEach(p => { p.ball = hole.tee.slice(); p.lie = 'tee'; p.strokes = 0; p.done = false; p.lastPos = hole.tee.slice(); p.order = prev != null && p.scores[prev] != null ? p.scores[prev] : 0; });
  const honour = players.slice().sort((a, b) => a.order - b.order || a.i - b.i)[0].i;
  loadPlayer(honour);
  const r = GolfGeo.rng(1000 + i * 37 + new Date().getDate());
  // pin: a few metres from the green's centre, still on the green
  const g = course.greens[hole.green].a, gc = GolfGeo.centroid(g);
  pin = gc.slice();
  for (let k = 0; k < 12; k++){ const a = r() * Math.PI * 2, d = 2 + r() * 4, p = [gc[0] + Math.cos(a)*d, gc[1] + Math.sin(a)*d];
    if (GolfGeo.pip(p[0], p[1], g) && GolfGeo.edgeDist(p[0], p[1], g) > 3){ pin = p; break; } }
  // a new wind every hole: a whole number from 1 to 10 m/s, from any direction (like Wii golf)
  const wa = Math.random() * Math.PI * 2, ws = settings.wind ? 1 + Math.floor(Math.random() * 10) : 0; windV = [Math.cos(wa) * ws, Math.sin(wa) * ws];
  scene.setPin(pin[0], pin[1]); scene.setBall(ball[0], ball[1]);
  // hole intro: show the whole hole from above, then drop behind the ball
  const c = [(hole.tee[0] + pin[0]) / 2, (hole.tee[1] + pin[1]) / 2];
  scene.view('map', {center: c, span: Math.max(160, hole.len * 1.05), ang: angTo(hole.tee, pin), snap: true});
  scene.golfer.visible = false; reading = false; scene.showRead(hole.green, false);
  showCard(`Hole ${hole.n}`, `Par ${hole.par} · ${hole.card || hole.len} m` + (hole.index ? ` · Index ${hole.index}` : '') + (hole.note ? `\n${hole.note}` : ''), 2600);
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
function nextPlayer(){
  if (players.length < 2) return;
  savePlayer();
  const left = players.filter(p => !p.done); if (!left.length) return;
  const far = left.sort((a, b) => (dist(b.ball, pin) - dist(a.ball, pin)) || (a.i === cur ? -1 : b.i === cur ? 1 : 0)   /* level (on the tee): whoever has the honour */)[0];
  if (far.i !== cur){ loadPlayer(far.i); }
}
function prepareShot(){
  if (mode === 'roundEnd' || mode === 'menu') return;
  if (players.length > 1){
    const was = cur; nextPlayer();
    const P = players[cur];
    callout(`${P.name}'s turn`, cur ? 'p2' : 'p1');
    players.forEach((p, i) => { if (i !== cur) sendTo(i, {t:'state', text: `${P.name} is playing. Wait for your turn.`, mode: 'wait'}); });
    scene.setOthers(players.filter(p => p.i !== cur && !p.done).map(p => ({x: p.ball[0], y: p.ball[1], color: p.color})));
    void was;
  }
  club = autoClub(); aim = autoAim(); mode = 'aim'; setSpin(0, 0);
  scene.setBall(ball[0], ball[1]); scene.clearTrail(); scene.placeGolfer(ball, aim, club === 'Pt'); meter.reset();
  scene.setFlagIn(club !== 'Pt');
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
function setClub(k){ if (!CLUBS[k]) return; const wasPutt = club === 'Pt'; club = k; scene.setFlagIn(k !== 'Pt'); if (wasPutt !== (k === 'Pt')){ aim = angTo(ball, k === 'Pt' ? pin : pin); scene.placeGolfer(ball, aim, k === 'Pt'); setView(); } updateHUD(); }
// Wii-style green read: coloured grid with downhill arrows on the green you're putting to
function toggleRead(){
  if (mode !== 'aim' && mode !== 'intro') return;
  // only on or around the green, and it stays in the normal view (no jump to the overhead map)
  if (!reading && !(onGreenLie() || club === 'Pt' || dist(ball, pin) < 25)){ banner('You can read the green once you\'re on or near it.'); return; }
  reading = !reading; scene.showRead(hole.green, reading); $('#readBtn').classList.toggle('on', reading);
}
function sendState(){
  if (!hole) return;
  const txt = mode === 'aim' ? `Hole ${hole.n} · Par ${hole.par} · ${fmtM(dist(ball, pin))} to the pin · ${LIE_NAME[lie]}` : `Hole ${hole.n}`;
  send({t:'state', text: txt, mode, club});
}

// ---------- spin: where you strike the ball ----------
function setSpin(top, side, fromPhone){
  spin = {top: Math.max(-1, Math.min(1, top)), side: Math.max(-1, Math.min(1, side))};
  const d = $('#spinDot'); if (d){ d.style.left = (50 + spin.side * 38) + '%'; d.style.top = (50 - spin.top * 38) + '%'; }
  const L = $('#spinLab'); if (L){ const t = spin.top > 0.25 ? 'Topspin' : spin.top < -0.25 ? 'Backspin' : '', sd = spin.side > 0.25 ? 'fade' : spin.side < -0.25 ? 'draw' : '';
    L.textContent = t && sd ? `${t} + ${sd}` : t || (sd ? sd[0].toUpperCase() + sd.slice(1) + ' spin' : 'No spin'); }
  if (!fromPhone) send({t:'spin', top: spin.top, side: spin.side});
}
function initSpinPad(){
  const pad = $('#spinPad'); if (!pad) return;
  const set = e => { const r = pad.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1, l = Math.hypot(x, y);
    const k = l > 1 ? 1 / l : 1, sx = x * k, sy = y * k; setSpin(Math.abs(sy) < 0.15 ? 0 : -sy, Math.abs(sx) < 0.15 ? 0 : sx); };
  pad.addEventListener('pointerdown', e => { if (mode === 'aim' && club !== 'Pt'){ set(e); pad.setPointerCapture(e.pointerId); } });
  pad.addEventListener('pointermove', e => { if (e.buttons && mode === 'aim' && club !== 'Pt') set(e); });
  pad.addEventListener('dblclick', () => setSpin(0, 0));
}

// ---------- swings ----------
function faceToSide(face, putt){
  const k = CURVE[settings.curve] * GolfPhysics.difficulty.curve; if (!k) return 0;
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
// the putter's range for this putt, and the lie's distance range (Wii golf style)
function puttMax(){ return GolfPhysics.puttRange(dist(ball, pin)); }
function lieText(){ const r = GolfPhysics.lieRange(lie, club); return r[0] === 1 && r[1] === 1 ? '100%' : r[0] === r[1] ? Math.round(r[0] * 100) + '%' : `${Math.round(r[0] * 100)}–${Math.round(r[1] * 100)}%`; }
function greenField(p){ return scene.greenAt(p[0], p[1]) || scene.fields[hole.green]; }
function takeShot(power, faceSide, over){
  strokes++; lastPos = ball.slice(); mode = 'flight'; scene.showAim(ball, 0, 0); updateHUD(); sendState();
  reading = false; scene.showRead(hole.green, false); scene.clearTrail();
  // the golfer swings; the ball leaves at impact
  scene.golfer.setClub(club === 'Pt'); scene.golfer.putter = club === 'Pt';
  GolfSound.swing(club === 'Pt' ? 0.2 : power);
  scene.golfer.swing(() => launch(power, faceSide, over));
}
function launch(power, faceSide, over){
  const putting = club === 'Pt';
  GolfSound.hit(power, putting);
  if (putting){
    const r = GolfPhysics.putt(course, {from: ball, ang: aim - faceSide * Math.PI / 180, power, pin, max: puttMax(), field: greenField(ball)});   // + face pushes it right
    shotInfo = {club, lie, from: ball.slice(), power, putt: true};
    animatePutt(r);
    return;
  }
  const C = CLUBS[club];
  let side = faceSide * 0.9 * C.curve * (C.max * power / 100);
  // overswing: the bar goes haywire and it's a coin flip whether it slices right or hooks left
  if (over){ const dir = Math.random() < 0.5 ? -1 : 1; side = dir * (0.1 + Math.random() * 0.07) * C.max * power * Math.max(0.5, C.curve); banner(dir > 0 ? 'Overswing! Big slice.' : 'Overswing! Big hook.'); }
  const lr = GolfPhysics.lieRange(lie, club), lieK = lr[0] + Math.random() * (lr[1] - lr[0]);
  shotInfo = {club, lie, from: ball.slice(), power, over, lieK, spin: {...spin}, aim};
  const r = GolfPhysics.fullShot(course, {from: ball, ang: aim, club, power, lie, lieK, wind: windV, side, pin, spin, field: scene.fields[hole.green]});
  animateFlight(r);
}

// ---------- animation ----------
let anim = null;
function animateFlight(r){
  const dur = 2.3 + r.carry / 80;   // slower, floatier flight like Wii golf
  anim = {kind: 'flight', r, t0: performance.now(), dur, landed: false};
}
function animatePutt(r){ anim = {kind: 'putt', r, t0: performance.now()}; }
// position along a [x, y, h, t] track at time t (seconds)
function trackAt(T, t){
  if (t <= T[0][3]) return T[0];
  let lo = 0, hi = T.length - 1;
  if (t >= T[hi][3]) return T[hi];
  while (hi - lo > 1){ const m = (lo + hi) >> 1; if (T[m][3] <= t) lo = m; else hi = m; }
  const a = T[lo], b = T[hi], k = (t - a[3]) / Math.max(1e-6, b[3] - a[3]);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, t];
}
function stepAnim(now){
  if (!anim) return;
  const t = Math.max(0, (now - anim.t0) / 1000 * SPEED());   // rAF time can be slightly older than t0
  if (anim.kind === 'flight'){
    const {r, dur} = anim, S = r.samples;
    if (t < dur){
      const f = t / dur, idx = f * (S.length - 1), i = Math.floor(idx), k = idx - i, a = S[i], b = S[Math.min(S.length - 1, i + 1)];
      const p = [a[0] + (b[0]-a[0])*k, a[1] + (b[1]-a[1])*k, a[2] + (b[2]-a[2])*k];
      scene.setBall(p[0], p[1], p[2], true); scene.view('follow', {ball: p, ang: aim, h: p[2]});
      return;
    }
    if (!anim.landed){ anim.landed = true; if (r.events.includes('leaves')) GolfSound.leaves(); const l0 = course.lie(r.land[0], r.land[1]); if (l0 === 'water') GolfSound.splash(); else GolfSound.land(l0 === 'green' || l0 === 'rough' || l0 === 'bunker'); }
    // bounces and roll, in real time from the physics
    const R = r.rollTrack, rt = t - dur, end = R[R.length - 1][3];
    if (rt < end && R.length > 1){
      const p = trackAt(R, rt);
      if (anim.lastH > 0.03 && p[2] <= 0.03 && p[2] > -0.01) GolfSound.land(true);
      if (!anim.rattled && p[2] < -0.06){ anim.rattled = true; GolfSound.cup(); }
      anim.lastH = p[2];
      scene.setBall(p[0], p[1], p[2]); scene.view('watch', {ball: p}); return;
    }
    if (r.holed){ anim = null; return finishShot(r.rest, r.lie, r.holed, [], r.events, r); }
    anim = null; finishShot(r.rest, r.lie, r.holed, r.samples.concat(R.map(p => [p[0], p[1], 0])), r.events, r);
  } else if (anim.kind === 'putt'){
    const {r} = anim, T = r.track, end = T[T.length - 1][3];
    if (t < end){ const p = trackAt(T, t);
      if (!anim.rattled && p[2] < -0.06){ anim.rattled = true; GolfSound.cup(); }
      scene.setBall(p[0], p[1], p[2]); scene.view('address', {ball: [p[0] - Math.cos(aim)*0.01, p[1] - Math.sin(aim)*0.01], ang: aim, putt: true, toPin: dist(p, pin)}); return; }
    if (r.holed){ anim = null; return finishShot(r.rest, r.lie, r.holed, [], [], r); }
    anim = null; finishShot(r.rest, r.lie, r.holed, T.map(p => [p[0], p[1], 0]), r.lip ? ['lip'] : [], r);
  }
}

let shotInfo = null;
// big Wii-style call-outs in the middle of the screen
function callout(text, kind = ''){ const c = $('#callout'); c.textContent = text; c.className = kind; void c.offsetWidth; c.classList.add('show'); clearTimeout(callout.h); callout.h = window.setTimeout(() => c.classList.remove('show'), 1900); }
function shotShape(r){
  // where it finished relative to the line it was aimed on
  if (!shotInfo || shotInfo.putt) return '';
  const a = shotInfo.aim, rx = Math.sin(a), ry = -Math.cos(a), off = (r.rest[0] - shotInfo.from[0]) * rx + (r.rest[1] - shotInfo.from[1]) * ry;
  return Math.abs(off) < 4 ? 'straight' : off > 0 ? (off < 12 ? 'slight fade' : 'slice') : (off > -12 ? 'slight draw' : 'hook');
}
function finishShot(rest, newLie, holed, track, events, r = {}){
  mode = 'result';
  const fromOff = club !== 'Pt', P = GolfPhysics.difficulty;
  if (holed){
    if (r.lipIn) callout('Lip in!', 'gold'); else if (fromOff && strokes > 1) callout('Chip-in!', 'gold');
  }
  if (!holed && newLie === 'ob') callout('OB', 'bad');
  else if (!holed && newLie === 'water') callout('Water hazard', 'bad');
  else if (!holed && (r.lip === 'out' || r.lip === 'over')) callout('Lip out!', 'bad');
  else if (!holed && fromOff && newLie === 'green' && dist(rest, pin) < 3) callout('Great approach!', 'gold');
  else if (!holed && fromOff && newLie === 'green') callout('Nice On!');
  else if (!holed && club === 'Dr' && newLie === 'fairway' && dist(rest, lastPos) > 220) callout('Nice Shot!');
  if (holed){ ball = pin.slice(); return holeOut(); }   // the ball stays at the bottom of the cup
  let msg = '';
  if (newLie === 'ob'){ strokes++; ball = lastPos.slice(); lie = course.lie(ball[0], ball[1]); msg = 'Out of bounds. One-stroke penalty, play again.'; }
  else if (newLie === 'water'){ strokes++; ball = GolfPhysics.dropPoint(course, track, lastPos); lie = course.lie(ball[0], ball[1]); if (lie === 'water' || lie === 'ob'){ ball = lastPos.slice(); lie = course.lie(ball[0], ball[1]); } msg = 'In the water. One-stroke penalty, dropping out.'; }
  else { ball = rest; lie = newLie; }
  if (!msg){
    const d = dist(ball, pin);
    // what happened, then the numbers: carry, total, power and shape for full shots
    if (events.includes('tree')) msg = 'Hit a tree! ';
    else if (events.includes('leaves')) msg = 'Clipped the leaves! ';
    else if (events.includes('lip')) msg = 'Lipped out! ';
    msg += lie === 'green' ? `On the green, ${fmtM(d)} away.` : lie === 'bunker' ? 'In the bunker.' : lie === 'rough' ? `In the rough, ${fmtM(d)} to go.` : lie === 'fringe' ? `On the fringe, ${fmtM(d)}.` : `${LIE_NAME[lie]}, ${fmtM(d)} to go.`;
    if (fromOff && r.carry != null && shotInfo){
      const bits = [`Carry ${fmtM(r.carry)}`, `total ${fmtM(r.total)}`, `${Math.round(shotInfo.power * 100)}% power`];
      if (!shotInfo.over) bits.push(shotShape(r)); else bits.push('overswing');
      if (shotInfo.lieK < 0.9) bits.push(`${LIE_NAME[shotInfo.lie].toLowerCase()} cost ${Math.round((1 - shotInfo.lieK) * 100)}%`);
      msg += '\n' + bits.join(' · ');
    }
    if (club === 'Pt' && P.gimme > 0 && d < P.gimme){ msg = d < 0.35 ? 'Tap-in.' : 'That\'s a gimme.'; strokes++; ball = pin.slice(); scene.setBall(ball[0], ball[1]); banner(msg); return later(holeOut, 900); }
  }
  if (strokes >= 10){ banner('Picking up. That one is a 10.'); strokes = 10; return later(holeOut, 1500); }
  banner(msg); updateHUD();
  later(prepareShot, 1800);
}
const NAMES = {'-3':'Albatross!', '-2':'Eagle!', '-1':'Birdie!', '0':'Par', '1':'Bogey', '2':'Double bogey', '3':'Triple bogey'};
function holeOut(){
  mode = 'holeEnd';
  scores[holeIdx] = strokes; players[cur].done = true; saveRound();
  const diff = strokes - hole.par;
  const name = strokes === 1 ? 'Hole in one!' : NAMES[diff] || (diff > 0 ? `+${diff}` : `${diff}`);
  if (strokes === 1){ callout('Hole in One!', 'gold'); GolfSound.cheer(2); } else if (diff < 0){ window.setTimeout(() => callout(name, 'gold'), 600); GolfSound.cheer(diff < -1 ? 2 : 1); }
  showCard(players.length > 1 ? `${players[cur].name}: ${name}` : name, `${strokes} ${strokes === 1 ? 'stroke' : 'strokes'} on hole ${hole.n}`, 2600);
  if (players.some(p => !p.done)){ updateHUD(); later(prepareShot, 2800); return; }   // the other player still has to finish the hole
  scene.setOthers([]);
  updateHUD(); send({t:'state', text: `${name} ${strokes} on hole ${hole.n}`, mode});
  later(() => {
    const k = roundHoles.indexOf(holeIdx);
    if (k >= 0 && k + 1 < roundHoles.length) startHole(roundHoles[k + 1]);
    else {
      mode = 'roundEnd'; store.set('wgolf-round', null);
      // personal best for this course and round
      const t = totals(), key = `wgolf-best-${course.d.id}-${roundName}`, best = store.get(key, null);
      if (players.length === 1 && roundHoles.every(i => scores[i] != null) && (best == null || t.s < best)){ store.set(key, t.s); if (best != null){ callout('New personal best!', 'gold'); GolfSound.cheer(2); } }
      showScorecard(true);
      if (best != null && players.length === 1) $('#scoreSum').textContent += ` Your best: ${Math.min(best, t.s)}.`;
    }
  }, 2800);
}

// ---------- swing bar (Wii style) ----------
// Fills live from the phone's rotation speed while you hold the pad; 100% is your full swing from the Swing Lab.
const cal = {full: 1100, putt: 300};
const meter = {
  peak: 0, held: false, shown: 0, hideT: 0,
  // The bar shows the distance you'll actually get: from the rough or a bunker your swing is worth less,
  // so the fill is scaled down and the white "full" line drops, with the striped red zone above it.
  k: 1, top: 1,
  scale(p){ return Math.max(0, Math.min(1.3, p)) / 1.3 * 100; },
  setLie(){ const r = club === 'Pt' ? [1, 1] : GolfPhysics.lieRange(lie, club); this.k = (r[0] + r[1]) / 2; this.top = r[1];
    $('#meter .full').style.bottom = this.scale(this.top) + '%'; $('#meter .over').style.height = (100 - this.scale(this.top)) + '%';
    $('#meter').classList.toggle('lowered', this.top < 0.99); },
  draw(p, final){ const el = $('#meter'); el.classList.toggle('done', !!final);
    $('#mFill').style.height = this.scale(p * this.k) + '%'; $('#mLab').textContent = Math.round(p * 100) + '%';
    $('#mPeak').style.bottom = this.scale(this.peak * this.k) + '%'; $('#mPeak').style.opacity = this.peak > 0.05 ? 1 : 0;
    $('#mLab').style.color = p > 1.15 ? '#b3372b' : ''; },
  reset(){ this.peak = 0; this.draw(0); },
  live(p){ this.peak = Math.max(this.peak, p); this.draw(p); if (p > 1.15 && club !== 'Pt' && !$('#meter').classList.contains('crazy')) this.crazy(); },
  fromPhone(r, held){
    if (mode !== 'aim') return;
    if (held && !this.held) this.peak = 0;
    this.held = held;
    const putt = club === 'Pt', chip = ['9i', 'PW', 'SW'].includes(club);
    const floor = putt ? 30 : chip ? 60 : 150, top = putt ? cal.putt : cal.full;
    // fills while you hold the pad and swing
    const p = Math.max(0, (r - floor) / (top - floor));
    if (held){ if (!this.live_ || performance.now() - this.lastLive > 900) this.peak = 0; this.live_ = true; this.lastLive = performance.now(); this.live(p); }
  },
  final(p){ this.peak = Math.max(this.peak, p); this.draw(p, true); },
  crazy(){ const el = $('#meter'); el.classList.remove('crazy'); void el.offsetWidth; el.classList.add('crazy'); clearTimeout(this.cz); this.cz = window.setTimeout(() => el.classList.remove('crazy'), 1600); },
  pinTick(){   // where the bar needs to reach to get to the pin
    const t = $('#mPin'); if (!hole || mode !== 'aim'){ t.style.display = 'none'; return; }
    const C = CLUBS[club], d = playsLike();
    const need = C.putt ? d / puttMax() : Math.pow(Math.min(1.3, d / (C.max * GolfPhysics.lieFactor(lie, club))), 1 / 0.9);
    t.style.display = need <= 1.3 ? 'block' : 'none'; t.style.bottom = this.scale(need * (C.putt ? 1 : this.k)) + '%';
  }
};
// distance adjusted for height: uphill plays longer, downhill shorter
function playsLike(){ const d = dist(ball, pin); if (!course.terrain || club === 'Pt') return d; return d + (course.terrain.height(pin[0], pin[1]) - course.terrain.height(ball[0], ball[1])) * 1.1; }

// ---------- HUD ----------
function banner(t){ const b = $('#banner'); b.textContent = t; b.classList.add('show'); clearTimeout(banner.h); banner.h = window.setTimeout(() => b.classList.remove('show'), 2600); }
function showCard(a, b, ms){ $('#cardA').textContent = a; $('#cardB').textContent = b; const c = $('#holeCard'); c.classList.add('show'); clearTimeout(showCard.h); showCard.h = window.setTimeout(() => c.classList.remove('show'), ms); }
function totals(){ let s = 0, p = 0; course.d.holes.forEach((h, i) => { if (scores[i] != null && (!roundHoles.length || roundHoles.includes(i))){ s += scores[i]; p += h.par; } }); return {s, p}; }
function updateHUD(){
  if (!hole) return;
  const C = CLUBS[club], d = dist(ball, pin);
  const tag = $('#hPlayer'); tag.hidden = players.length < 2; if (players.length > 1){ tag.textContent = players[cur].name; tag.style.background = players[cur].color; }
  $('#hHole').textContent = hole.n; $('#hPar').textContent = `Par ${hole.par} · ${hole.card || hole.len} m`;
  $('#hStroke').textContent = mode === 'aim' ? `Shot ${strokes + 1}` : `Shot ${strokes}`;
  const t = totals(), tp = t.s - t.p; $('#hTotal').textContent = t.p ? (tp === 0 ? 'E' : tp > 0 ? '+' + tp : tp) : 'E';
  $('#hPin').textContent = fmtM(d); $('#hLie').textContent = C.putt ? (LIE_NAME[lie] || lie) : `${LIE_NAME[lie] || lie} ${lieText()}`;
  const pl = playsLike(); $('#playsRow').hidden = Math.abs(pl - d) < 2 || club === 'Pt'; $('#hPlays').textContent = `${fmtM(pl)} ${pl > d ? 'uphill' : 'downhill'}`;
  meter.setLie(); meter.pinTick();
  $('#hClub').textContent = C.name;
  $('#hClubMax').textContent = C.putt ? `Putter range ${puttMax()} m` : `Up to ${Math.round(C.max * GolfPhysics.lieFactor(lie, club))} m`;
  const ws = Math.hypot(windV[0], windV[1]);
  $('#hWind').textContent = ws < 0.3 ? 'Calm' : `${Math.round(ws)} m/s`;
  $('#windArrow').style.transform = `rotate(${(aim - Math.atan2(windV[1], windV[0])) * 180 / Math.PI}deg)`;
  $('#windArrow').style.opacity = ws < 0.3 ? 0.25 : 1;
  if (mode === 'aim'){
    const reach = C.putt ? Math.min(d, puttMax()) : C.max * GolfPhysics.lieFactor(lie, club);
    scene.showAim(ball, aim, C.putt ? Math.min(d + 0.5, puttMax()) : Math.min(reach, Math.max(reach * 0.5, d)), C.putt);
  }
  $('#spinBox').hidden = !(mode === 'aim' && !C.putt);
  $('#hint').textContent = mode === 'aim' ? (phoneOk ? (C.putt ? 'Hold the pad and putt.' : 'Hold the pad and swing.') : 'Link your phone, or hold Space to swing.') : '';
  drawMini();
}
function showScorecard(final){
  const idx = roundHoles.length ? roundHoles : course.d.holes.map((h, i) => i), holes = idx.map(i => course.d.holes[i]);
  const row = (label, f, cls = '') => `<tr class="${cls}"><th>${label}</th>${holes.map((h, i) => `<td class="${f.cls ? f.cls(h, i) : ''}"><span>${f(h, i)}</span></td>`).join('')}</tr>`;
  savePlayer();
  const scoreRow = S => { const f = (h, i) => S[idx[i]] == null ? '' : S[idx[i]]; f.cls = (h, i) => S[idx[i]] == null ? '' : S[idx[i]] < h.par ? 'under' : S[idx[i]] > h.par ? 'over' : 'par'; return f; };
  const tot = S => { let s = 0, p = 0; idx.forEach(i => { if (S[i] != null){ s += S[i]; p += course.d.holes[i].par; } }); return {s, p}; };
  const vsPar = t => { const d = t.s - t.p; return d === 0 ? 'level par' : d > 0 ? d + ' over par' : -d + ' under par'; };
  const multi = players.length > 1;
  const rows = multi ? players.map(P => row(`<i style="background:${P.color}"></i>${P.name.replace('Player ', 'P')}`, scoreRow(P.scores), 'pl')).join('') : row('Score', scoreRow(scores));
  $('#scoreTable').innerHTML = `<table>${row('Hole', h => h.n)}${row('Metres', h => h.len, 'dim')}${row('Par', h => h.par)}${rows}</table>`;
  if (multi){
    const T = players.map(P => tot(P.scores));
    let sum = T.some(t => t.p) ? players.map((P, i) => `${P.name}: ${T[i].s} (${vsPar(T[i])})`).join(' · ') : 'No holes finished yet.';
    if (final && T[0].s !== T[1].s) sum += ` · ${players[T[0].s < T[1].s ? 0 : 1].name} wins!`;
    else if (final) sum += ' · All square!';
    $('#scoreSum').textContent = sum;
  } else { const t = tot(scores); $('#scoreSum').textContent = t.p ? `${t.s} strokes, ${vsPar(t)}` : 'No holes finished yet.'; }
  $('#scoreTitle').textContent = (final ? 'Round complete' : 'Scorecard') + ` · ${course.d.name} · ${roundName}`;
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
  if (mode === 'aim'){ const C = CLUBS[club], L = C.putt ? Math.min(puttMax(), dist(ball, pin) + 0.5) : C.max * GolfPhysics.lieFactor(lie, club);
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
  GolfSound.unlock();
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  if (e.key === 'ArrowLeft') aimHeld = 1;            // left on screen = anticlockwise
  else if (e.key === 'ArrowRight') aimHeld = -1;
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown'){ if (mode !== 'aim') return; const i = ORDER.indexOf(club) + (e.key === 'ArrowUp' ? -1 : 1); if (i >= 0 && i < ORDER.length){ setClub(ORDER[i]); send({t:'club', club}); } e.preventDefault(); }
  else if (e.key === 'g' || e.key === 'G') toggleRead();
  else if (e.key === 'm' || e.key === 'M') toggleMap();
  else if (e.key === 's' || e.key === 'S'){ if (course) showScorecard(false); }
  else if ('ijklIJKL'.includes(e.key) && mode === 'aim' && club !== 'Pt'){ const k = e.key.toLowerCase(); setSpin(spin.top + (k === 'i' ? 0.5 : k === 'k' ? -0.5 : 0), spin.side + (k === 'l' ? 0.5 : k === 'j' ? -0.5 : 0)); }
  else if (e.key === 'x' || e.key === 'X'){ if (mode === 'aim') setSpin(0, 0); }
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

// ---------- first-time guide: welcome, link the phone, set your swing, how to play ----------
const guide = {
  open: false, step: 0, pending: null, calCount: 0,
  steps: [
    {title: 'Welcome to Northside Golf', body: () => `<p>Real Sydney courses, played like Wii golf: your phone is the club and this screen is the course.</p>
      <ul><li><b>Hold it safely:</b> grip the phone firmly in both hands, like the handle of a club, with your thumb on the green pad.</li>
      <li>Give yourself room: check nobody and nothing is within a club's length.</li>
      <li>No phone handy? You can play with the keyboard instead.</li></ul>`},
    {title: 'Link your phone', body: () => `<div class="pairRow"><div id="gQr" style="width:170px;height:170px;background:#fff;border-radius:12px;padding:8px;display:grid;place-items:center;border:1px solid var(--panel-line);flex:none">${qrImg || 'Making a code…'}</div>
      <ol><li>Point your phone's camera at the code and open the link.</li><li>Tap <b>Start</b>.</li><li>When it asks about <b>motion</b>, tap <b>Allow</b> (iPhones ask once).</li></ol></div>
      <div class="gStatus"><span><span class="dotLive" id="gDot"></span><span id="gTxt"></span></span></div>
      <p style="font-size:14px;color:var(--panel-muted)">Phone and computer just need internet. If the code won't link, press "Make a new code" in the Phone code window.</p>`},
    {title: 'Set your swing', body: () => `<p>Make <b>three smooth, full swings</b> (hold the green pad while you swing). That sets what 100% power feels like for you, and what "straight" is.</p>
      <div class="calDots" id="gCal"><span>●</span><span>●</span><span>●</span></div><p id="gCalTxt" style="color:var(--panel-muted)"></p>`},
    {title: 'How to play', body: () => `<ul>
      <li><b>Aim</b> with ◀ ▶ on the phone (or the arrow keys).</li>
      <li><b>Clubs</b> are picked for you; change them on the phone (or ↑ ↓).</li>
      <li><b>Swing</b>: hold the pad and swing. The bar on the left shows your power. Past the white line is an <b>overswing</b>, which can hook or slice wildly. From the rough or sand the white line drops: you can't hit it as far.</li>
      <li><b>Spin</b>: tap the ball (bottom right) — top for topspin and more roll, bottom for backspin that stops, sides to curve it.</li>
      <li><b>Putting</b>: a smaller, gentler stroke. The putter's range fits the putt; press <b>Read</b> (or G) on the green to see the slopes.</li>
      <li><b>Scoring</b>: get it in the hole in as few shots as you can. Par is the target; one under is a birdie.</li></ul>`}
  ],
  show(step = 0, pending = null){ this.open = true; this.pending = pending || this.pending; $('#guide').hidden = false; this.go(step); },
  go(i){
    if (this.step === 2 && i !== 2 && this.calCount < 3) sendTo(0, {t:'calibrate', cancel: true});   // leaving setup half-way: stop it on the phone
    this.step = Math.max(0, Math.min(this.steps.length - 1, i)); const S = this.steps[this.step];
    $('#gTitle').textContent = S.title; $('#gBody').innerHTML = S.body();
    [...$('#gSteps').children].forEach((el, k) => el.classList.toggle('on', k <= this.step));
    $('#gBack').hidden = this.step === 0;
    $('#gNext').textContent = this.step === this.steps.length - 1 ? 'Start playing' : this.step === 2 ? 'Next (or skip)' : 'Next';
    $('#gSkip').textContent = this.step === 0 ? 'Play with keyboard' : 'Skip setup';
    $('#gNext').disabled = false;
    if (this.step === 1) pairStatus();
    if (this.step === 2){ this.calCount = 0; this.paintCal(phones[0].ok ? 'Swing when you\'re ready.' : 'No phone linked: you can skip this.'); if (phones[0].ok) sendTo(0, {t:'calibrate', mode: 'full'}); }
  },
  paintCal(t){ const d = $('#gCal'); if (d) [...d.children].forEach((el, k) => el.classList.toggle('on', k < this.calCount)); const tt = $('#gCalTxt'); if (tt && t) tt.textContent = t; },
  onCal(m){ if (!this.open || this.step !== 2) return;
    if (m.cancelled){ this.paintCal('Cancelled on the phone.'); return; }
    if (m.step != null){ this.calCount = m.step; this.paintCal(m.step >= 3 ? 'Saved. That\'s your 100%.' : `Swing ${m.step} of 3 done.`); if (m.step >= 3) window.setTimeout(() => this.open && this.step === 2 && this.go(3), 1200); } },
  finish(keyboard){
    if (this.step === 2 && this.calCount < 3) sendTo(0, {t:'calibrate', cancel: true});
    store.set('wgolf-onboarded', true); if (keyboard) store.set('wgolf-keyboard', true);
    $('#guide').hidden = true; this.open = false; const p = this.pending; this.pending = null;
    if (p) startRound(p.id, p.resume, p.spec);
  }
};
$('#gNext').onclick = () => { if (guide.step === guide.steps.length - 1) guide.finish(false); else guide.go(guide.step + (guide.step === 1 && !phones[0].ok ? 2 : 1)); };
$('#gBack').onclick = () => guide.go(guide.step - 1);
$('#gSkip').onclick = () => guide.finish(guide.step === 0);

// ---------- menu ----------
function initMenu(){
  const saved = store.get('wgolf-round', null);
  document.querySelectorAll('.course[data-course]').forEach(el => {
    const id = el.dataset.course, rb = el.querySelector('.resume'), sel = el.querySelector('.roundSel');
    if (sel && !sel.options.length){
      const n = window.COURSES[id].holes.length;
      sel.innerHTML = `<option value="all">18 holes</option><option value="front">Front 9</option><option value="back">Back 9</option><option value="quick3">Quick 3 holes</option>` +
        Array.from({length: n}, (_, i) => `<option value="${i + 1}">Hole ${i + 1} only</option>`).join('');
    }
    rb.hidden = !(saved && saved.course === id && saved.hole != null && (saved.scores || []).some(v => v != null));
    if (!rb.hidden) rb.textContent = `Resume (${saved.name || '18 holes'}, hole ${saved.hole + 1})`;
    el.querySelector('.play').onclick = () => startRound(id, false, sel ? sel.value : 'all');
    rb.onclick = () => startRound(id, true);
  });
  const ps = $('#playersSel'); if (ps){ ps.value = String(nPlayers); ps.onchange = () => { nPlayers = Number(ps.value) === 2 ? 2 : 1; store.set('wgolf-players', nPlayers); pairText(); linkLabel(); }; }
  const ds = $('#diffSel'); if (ds){ ds.value = settings.difficulty; ds.onchange = () => { store.set('wgolf-difficulty', ds.value); GolfPhysics.setDifficulty(ds.value); if (hole) updateHUD(); }; }
  const mt = $('#muteChk'); if (mt){ mt.checked = !GolfSound.muted; mt.onchange = () => GolfSound.setMuted(!mt.checked); }
  $('#menuBtn').onclick = () => { $('#menu').hidden = false; $('#hud').hidden = true; mode = 'menu'; initMenu(); };
  $('#cardBtn').onclick = () => showScorecard(false);
  document.addEventListener('pointerdown', () => GolfSound.unlock(), {once: false, passive: true});
  $('#scoreClose').onclick = () => { $('#scoreModal').hidden = true; };
  $('#scoreNew').onclick = () => { $('#scoreModal').hidden = true; startRound(course ? course.d.id : 'warringah', false); };
  $('#pairBtn').onclick = () => { $('#pairModal').hidden = false; };
  $('#pairClose').onclick = () => { $('#pairModal').hidden = true; };
  $('#pairKeys').onclick = () => { store.set('wgolf-keyboard', true); $('#pairModal').hidden = true; toast('Hold Space to swing, arrows to aim and change club.', 3500); };
  $('#pairReset').onclick = () => { try { peer && peer.destroy(); } catch {} phoneOk = false; phones.forEach(p => { p.ok = false; p.conn = null; }); linkChip('Phone not linked', 'bad'); $('#qr').textContent = 'Making a code…'; store.set('wgolf-screen-id', null); tries = 0; startPeer('wgolf-' + rnd(6)); };
  $('#guideBtn').onclick = () => guide.show(0, null);
  $('#mapBtn').onclick = toggleMap; $('#readBtn').onclick = toggleRead;
  const cs = $('#curveSel'); cs.value = settings.curve; cs.onchange = () => store.set('wgolf-curve', cs.value);
  const wc = $('#windChk'); wc.checked = settings.wind; wc.onchange = () => store.set('wgolf-wind2', wc.checked);
  $('#ver').textContent = 'Version ' + VERSION;
  // a course picked before a reload
  let pick = null; try { pick = JSON.parse(sessionStorage.getItem('wgolf-start') || 'null'); sessionStorage.removeItem('wgolf-start'); } catch {}
  if (pick && window.COURSES[pick.id] && !course) window.setTimeout(() => startRound(pick.id, pick.resume, pick.spec || 'all'), 50);
}
window.addEventListener('resize', () => { if (scene) scene.resize(); });
initSpinPad();
initMenu();
startPeer(store.get('wgolf-screen-id', null) || ('wgolf-' + rnd(6)));
requestAnimationFrame(loop);
// for automated tests
window.__golf = {get mode(){ return mode; }, get ball(){ return ball; }, get pin(){ return pin; }, get strokes(){ return strokes; }, get scores(){ return scores; }, get hole(){ return holeIdx; }, get club(){ return club; }, get lie(){ return lie; }, get course(){ return course; }, get scene(){ return scene; }, takeShot: (p, f) => takeShot(p, f || 0, false), startRound, startHole, get roundHoles(){ return roundHoles; }, get players(){ savePlayer(); return players.map(p => ({name: p.name, scores: p.scores.slice(), ball: p.ball})); }, get cur(){ return cur; }};
})();
