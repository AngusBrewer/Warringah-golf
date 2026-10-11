// End-to-end: plays a whole round in a headless browser with a simple bot (straight shots at the pin,
// power chosen for the distance). Needs Playwright and a local web server:
//   python3 -m http.server 8765   (in the project folder)
//   COURSE=northbridge ROUND=front node tests/e2e-round.js
// Checks there are no page errors and that every hole of the round gets a score.
const { chromium } = require('playwright');
(async () => {
  const course = process.env.COURSE || 'warringah', round = process.env.ROUND || 'all', url = process.env.URL || 'http://localhost:8765/index.html';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: {width: 480, height: 320} });
  await ctx.addInitScript(() => { localStorage.setItem('wgolf-onboarded', 'true'); localStorage.setItem('wgolf-keyboard', 'true'); localStorage.setItem('wgolf-difficulty', '"standard"'); });
  await ctx.route('https://fonts.googleapis.com/**', r => r.abort());
  const errs = []; const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|fonts|PeerJS|WebSocket|peerjs/.test(m.text())) errs.push('console: ' + m.text()); });
  await pg.goto(url); await pg.waitForTimeout(800);
  await pg.evaluate(([c, r]) => window.__golf.startRound(c, false, r), [course, round]);
  await pg.evaluate(() => window.__golfSpeed = 6);
  await pg.waitForFunction(() => window.__golf.mode === 'aim', null, {timeout: 240000});
  const CL = {Dr:230,'3W':210,'5i':170,'7i':150,'9i':125,PW:105,SW:80};
  let shots = 0; const log = [];
  while (shots < 400){
    const st = await pg.evaluate(() => ({mode: window.__golf.mode, hole: window.__golf.hole, ball: window.__golf.ball, pin: window.__golf.pin, club: window.__golf.club, lie: window.__golf.lie}));
    if (st.mode === 'roundEnd') break;
    if (st.mode !== 'aim'){ await pg.waitForTimeout(60); continue; }
    const d = Math.hypot(st.ball[0]-st.pin[0], st.ball[1]-st.pin[1]);
    const p = await pg.evaluate(([d, club, lie]) => club === 'Pt' ? Math.min(1, Math.pow((d + 0.4) / GolfPhysics.puttRange(d), 1 / 0.85))
      : Math.min(1, Math.pow(Math.min(1, d / (GolfPhysics.CLUBS[club].max * GolfPhysics.lieFactor(lie, club))), 1 / 0.9)), [d, st.club, st.lie]);
    log.push(`h${st.hole + 1} ${st.lie} ${st.club} d=${d.toFixed(1)} p=${p.toFixed(2)}`);
    await pg.evaluate(p => window.__golf.takeShot(p), p); shots++;
    await pg.waitForTimeout(80);
  }
  await pg.waitForTimeout(500);
  const res = await pg.evaluate(() => ({scores: window.__golf.scores, holes: window.__golf.roundHoles}));
  const played = res.holes.map(i => res.scores[i]);
  console.log(course, round, 'shots', shots, 'scores', JSON.stringify(played), 'total', played.reduce((a, b) => a + (b || 0), 0));
  require('fs').writeFileSync(require('path').join(__dirname, 'last-round-log.txt'), log.join('\n'));
  const ok = !errs.length && played.every(v => v > 0);
  console.log(ok ? 'PASS' : 'FAIL', errs.slice(0, 5));
  await b.close(); process.exit(ok ? 0 : 1);
})();
