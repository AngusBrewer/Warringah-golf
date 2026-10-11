// Small synthesised sound effects (no audio files): swing, contact, landing, the cup, cheers.
// Browsers only allow sound after the player has clicked or pressed a key, so unlock() is called then.
(function(){
'use strict';
let ctx = null, master = null, muted = false;
try { muted = localStorage.getItem('wgolf-mute') === 'true'; } catch {}
function unlock(){
  if (!ctx){ const A = window.AudioContext || window.webkitAudioContext; if (!A) return; ctx = new A(); master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination); }
  if (ctx.state === 'suspended') ctx.resume();
}
function noise(dur){ const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = ctx.createBufferSource(); s.buffer = b; return s; }
function env(node, t0, a, peak, d){ const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); node.connect(g); g.connect(master); return g; }
function tone(freq, t0, dur, peak = 0.3, type = 'sine'){ const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0); env(o, t0, 0.005, peak, dur); o.start(t0); o.stop(t0 + dur + 0.05); return o; }
const ok = () => ctx && !muted && ctx.state === 'running';
const S = {
  unlock, get muted(){ return muted; },
  setMuted(m){ muted = !!m; try { localStorage.setItem('wgolf-mute', muted); } catch {} },
  swing(power = 1){ if (!ok()) return; const t = ctx.currentTime, n = noise(0.35), f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.25); n.connect(f); env(f, t, 0.12, 0.12 + 0.18 * power, 0.22); n.start(t); },
  hit(power = 1, putt = false){ if (!ok()) return; const t = ctx.currentTime;
    if (putt){ tone(1800, t, 0.05, 0.25, 'triangle'); tone(900, t, 0.08, 0.15); return; }
    const n = noise(0.08), f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500; n.connect(f); env(f, t, 0.002, 0.5 * (0.5 + power / 2), 0.07); n.start(t);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.12); env(o, t, 0.003, 0.35, 0.12); o.start(t); o.stop(t + 0.2); },
  land(soft = false){ if (!ok()) return; const t = ctx.currentTime, n = noise(0.12), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = soft ? 500 : 900; n.connect(f); env(f, t, 0.004, soft ? 0.12 : 0.2, 0.1); n.start(t); },
  cup(){ if (!ok()) return; const t = ctx.currentTime; [0, 0.07, 0.13, 0.18].forEach((d, i) => tone(1300 - i * 120, t + d, 0.06, 0.22 - i * 0.04, 'triangle')); tone(220, t + 0.2, 0.18, 0.25); },
  cheer(level = 1){ if (!ok()) return; const t = ctx.currentTime, notes = level > 1 ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047];
    notes.forEach((f, i) => tone(f, t + i * 0.09, 0.28, 0.16, 'triangle')); },
  splash(){ if (!ok()) return; const t = ctx.currentTime, n = noise(0.6), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(2500, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.5); n.connect(f); env(f, t, 0.01, 0.3, 0.5); n.start(t); },
  leaves(){ if (!ok()) return; const t = ctx.currentTime, n = noise(0.3), f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000; n.connect(f); env(f, t, 0.02, 0.15, 0.25); n.start(t); },
  thunk(){ if (!ok()) return; const t = ctx.currentTime; tone(140, t, 0.12, 0.35); }
};
window.GolfSound = S;
})();
