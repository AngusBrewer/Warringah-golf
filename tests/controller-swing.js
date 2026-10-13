// Checks the phone page's tap-then-swing flow with simulated motion (no real phone needed):
// tap the pad, hold still until it clicks ("Swing!"), then a backswing and a faster downswing.
//   python3 -m http.server 8765 ; node tests/controller-swing.js
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await (await b.newContext({viewport: {width: 390, height: 800}, hasTouch: true})).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('https://fonts.googleapis.com/**', r => r.abort());
  await pg.goto('http://localhost:8765/controller.html');
  // feed motion: rot = [alpha, beta, gamma] °/s at ~60 Hz
  await pg.evaluate(() => { window.__feed = (rr, ms) => new Promise(res => { const t0 = performance.now(); const id = setInterval(() => {
      window.dispatchEvent(new DeviceMotionEvent('devicemotion', {rotationRate: {alpha: rr[0], beta: rr[1], gamma: rr[2]}, accelerationIncludingGravity: {x: -9.8, y: 0, z: 0.3}, interval: 16}));
      if (performance.now() - t0 > ms){ clearInterval(id); res(); } }, 16); }); });
  await pg.click('#startBtn'); await pg.evaluate(() => __feed([1, 1, 1], 300));
  const text = s => pg.textContent(s);
  const results = [];
  const check = (name, ok, info = '') => { results.push(ok); console.log(ok ? '  ok  ' : '  FAIL', name, info); };
  check('waits for a tap before anything counts', (await text('#padBig')).includes('Tap'));
  await pg.evaluate(() => __feed([600, 200, 100], 400));        // waving the phone around before tapping: no shot
  check('swinging without tapping does nothing', (await text('#pw')).trim() === '–');
  await pg.click('#pad');
  check('a tap asks you to hold still', (await text('#padBig')).includes('still'));
  await pg.evaluate(() => __feed([3, 2, 4], 700));               // settle at address
  check('holding still arms it ("Swing!")', (await text('#padBig')).includes('Swing'), await text('#padBig'));
  // backswing, short pause, downswing, follow-through
  await pg.evaluate(async () => { await __feed([250, 60, 30], 350); await __feed([15, 5, 5], 150); await __feed([900, 250, 120], 180); await __feed([10, 5, 5], 900); });
  const pw = (await text('#pw')).trim();
  check('the downswing is taken as the shot', /\d+%/.test(pw), pw);
  check('it disarms after the shot', (await pg.evaluate(() => new Promise(r => setTimeout(() => r(document.querySelector('#padBig').textContent), 1600)))).includes('Tap'));
  await pg.click('#pad'); await pg.evaluate(() => __feed([200, 200, 200], 600));   // never still: no arming
  check('it will not arm while the phone is moving', !(await text('#padBig')).includes('Swing'));
  await pg.click('#pad');                                                           // second tap cancels
  check('tapping again cancels', (await text('#padBig')).includes('Tap'));
  check('no page errors', !errs.length, errs.join('; '));
  const ok = results.every(Boolean); console.log(ok ? 'PASS' : 'FAIL'); await b.close(); process.exit(ok ? 0 : 1);
})();
