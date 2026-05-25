/**
 * tracking.js – Zepto Wink Challenge
 * MediaPipe FaceMesh frame callback + hyper-responsive Lerp-based wink engine.
 *
 * Algorithm:
 *   leftScore  = clamp01((currentLeftEAR  - leftMin)  / (leftMax  - leftMin))
 *   rightScore = clamp01((currentRightEAR - rightMin) / (rightMax - rightMin))
 *   WINK condition: active eye score < 0.40  AND  opposite eye score > 0.50
 *
 * DOM updates are throttled: text/bar values only written when they actually change.
 */
'use strict';

// ─── getUserMedia Interceptor (Fixes MediaPipe track release bug) ──────────────
const _activeStreams = [];
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async function(constraints) {
    const stream = await originalGetUserMedia(constraints);
    if (stream) _activeStreams.push(stream);
    return stream;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────
const GAME_DURATION_S  = 45;
const MAX_DISCOUNT_PCT = 60;
const WINK_DEBOUNCE_MS = 260;   // min ms between registered winks on same side

// Eye aspect-ratio landmark indices (MediaPipe Face Mesh)
// EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
const LEFT_EYE_IDX  = { p1: 263, p2: 387, p3: 386, p4: 362, p5: 373, p6: 380 };
const RIGHT_EYE_IDX = { p1: 33,  p2: 160, p3: 159, p4: 133, p5: 144, p6: 153 };

// Wink scoring thresholds
const WINK_SCORE_ACTIVE   = 0.40;  // active eye score must be BELOW this
const WINK_SCORE_OPPOSITE = 0.50;  // opposite eye score must be ABOVE this

// ─── State ────────────────────────────────────────────────────────────────────
let _winkCount    = 0;
let _timeLeft     = GAME_DURATION_S;
let _gameActive   = false;
let _timerHandle  = null;
let _faceMesh     = null;
let _camera       = null;
let _promoCode    = '';

// Wink edge-detection per eye
const _eyeState = {
  left:  { wasWinking: false, lastWinkTs: 0 },
  right: { wasWinking: false, lastWinkTs: 0 },
};

// DOM value cache – avoids writing unchanged values every frame
const _cache = {
  earBarLeftW:  '',
  earBarRightW: '',
  earValLeft:   '',
  earValRight:  '',
  timerText:    '',
  timerBarW:    '',
  timerBarBg:   '',
  winkCount:    -1,
  discount:     '',
};

// Global flags (shared with calibration.js)
window._faceInRange    = false;
window._calibFaceReady = false;
window._recalibratingActive = false;

// ─── Utility ─────────────────────────────────────────────────────────────────
const _sleep = ms => new Promise(r => setTimeout(r, ms));

function _clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ─── EAR maths ───────────────────────────────────────────────────────────────
function _euclidean(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
function _computeEAR(landmarks, idx) {
  const p1 = landmarks[idx.p1], p2 = landmarks[idx.p2], p3 = landmarks[idx.p3];
  const p4 = landmarks[idx.p4], p5 = landmarks[idx.p5], p6 = landmarks[idx.p6];
  const h = _euclidean(p1, p4);
  if (h < 0.001) return 0.30;
  return (_euclidean(p2, p6) + _euclidean(p3, p5)) / (2.0 * h);
}

// ─── Lerp score engine ────────────────────────────────────────────────────────
function _lerpScore(ear, min, max) {
  if (max <= min) return 0.5; // degenerate guard
  return _clamp01((ear - min) / (max - min));
}

// ─── DOM helpers (throttled writes) ──────────────────────────────────────────
function _dom(id) { return document.getElementById(id); }

function _setWidth(el, id, w) {
  if (!el || _cache[id] === w) return;
  _cache[id] = w;
  el.style.width = w;
}
function _setText(el, id, t) {
  if (!el || _cache[id] === t) return;
  _cache[id] = t;
  el.textContent = t;
}
function _setBg(el, id, bg) {
  if (!el || _cache[id] === bg) return;
  _cache[id] = bg;
  el.style.background = bg;
}

// ─── EAR telemetry bars ───────────────────────────────────────────────────────
function _updateEARBars(leftScore, rightScore, lEAR, rEAR) {
  const barL = _dom('ear-bar-left');
  const barR = _dom('ear-bar-right');
  const valL = _dom('ear-val-left');
  const valR = _dom('ear-val-right');

  const lw = `${Math.round(leftScore  * 100)}%`;
  const rw = `${Math.round(rightScore * 100)}%`;
  _setWidth(barL, 'earBarLeftW',  lw);
  _setWidth(barR, 'earBarRightW', rw);

  const lv = lEAR.toFixed(2);
  const rv = rEAR.toFixed(2);
  _setText(valL, 'earValLeft',  lv);
  _setText(valR, 'earValRight', rv);

  // Colour coding: low score (closing) = red, high score (open) = green
  const lbg = leftScore  < 0.38 ? '#ff4444' : leftScore  > 0.75 ? '#44ff88' : 'linear-gradient(90deg,#c800ff,#ff5252)';
  const rbg = rightScore < 0.38 ? '#ff4444' : rightScore > 0.75 ? '#44ff88' : 'linear-gradient(90deg,#c800ff,#ff5252)';
  _setBg(barL, 'earBarLeftBg',  lbg);
  _setBg(barR, 'earBarRightBg', rbg);
}

// ─── Wink UI ─────────────────────────────────────────────────────────────────
function _updateWinkUI() {
  if (_cache.winkCount === _winkCount) return;
  _cache.winkCount = _winkCount;

  const display = _dom('wink-count-display');
  if (display) {
    display.textContent = _winkCount;
    display.classList.remove('pop');
    void display.offsetWidth; // force reflow for animation restart
    display.classList.add('pop');
  }

  const pct = Math.min(Math.floor(_winkCount / 3), MAX_DISCOUNT_PCT);
  const discText = `${pct}% Off`;
  const live = _dom('live-discount');
  _setText(live, 'discount', discText);
}

// ─── Wink flash ──────────────────────────────────────────────────────────────
let _winkFlashTimer = null;
function _triggerWinkFlash(side) {
  const wrapper   = _dom('video-wrapper');
  const indicator = _dom('wink-indicator');
  if (wrapper) wrapper.classList.add('wink-flash');
  clearTimeout(_winkFlashTimer);
  _winkFlashTimer = setTimeout(() => {
    if (wrapper) wrapper.classList.remove('wink-flash');
  }, 350);

  if (indicator) {
    indicator.textContent = side === 'LEFT' ? '👈 LEFT WINK!' : 'RIGHT WINK! 👉';
    indicator.classList.add('show');
    setTimeout(() => indicator.classList.remove('show'), 500);
  }
}

// ─── Double-blink warning ─────────────────────────────────────────────────────
let _blinkWarningTimer = null;
let _blinkWarningLastTs = 0;
const DOUBLE_BLINK_COOLDOWN_MS = 800;

function _triggerDoubleBlink() {
  const now = Date.now();
  if (now - _blinkWarningLastTs < DOUBLE_BLINK_COOLDOWN_MS) return;
  _blinkWarningLastTs = now;
  const el = _dom('blink-warning');
  if (!el) return;
  el.classList.add('show');
  clearTimeout(_blinkWarningTimer);
  _blinkWarningTimer = setTimeout(() => el.classList.remove('show'), 900);
}

// ─── Core wink detection (relaxed Lerp engine) ────────────────────────────────
function _processEARs(lEAR, rEAR) {
  if (!_gameActive || window._recalibratingActive) return;

  const p = window.userProfile;
  const leftScore  = _lerpScore(lEAR,  p.leftMin,  p.leftMax);
  const rightScore = _lerpScore(rEAR,  p.rightMin, p.rightMax);

  _updateEARBars(leftScore, rightScore, lEAR, rEAR);

  const now = Date.now();

  // ── Bilateral blink guard ────────────────────────────────────────────────
  // If both eyes are near-closed simultaneously → double blink, no wink credit
  if (leftScore < WINK_SCORE_ACTIVE && rightScore < WINK_SCORE_ACTIVE) {
    _eyeState.left.wasWinking  = false;
    _eyeState.right.wasWinking = false;
    _triggerDoubleBlink();
    return;
  }

  // ── Left eye wink ────────────────────────────────────────────────────────
  const leftIsWinking = leftScore < WINK_SCORE_ACTIVE && rightScore > WINK_SCORE_OPPOSITE;
  if (leftIsWinking) {
    _eyeState.left.wasWinking = true;
  } else if (_eyeState.left.wasWinking) {
    // Rising edge: eye just re-opened
    _eyeState.left.wasWinking = false;
    if (now - _eyeState.left.lastWinkTs > WINK_DEBOUNCE_MS) {
      _eyeState.left.lastWinkTs = now;
      _winkCount++;
      _updateWinkUI();
      _triggerWinkFlash('LEFT');
    }
  }

  // ── Right eye wink ───────────────────────────────────────────────────────
  const rightIsWinking = rightScore < WINK_SCORE_ACTIVE && leftScore > WINK_SCORE_OPPOSITE;
  if (rightIsWinking) {
    _eyeState.right.wasWinking = true;
  } else if (_eyeState.right.wasWinking) {
    // Rising edge: eye just re-opened
    _eyeState.right.wasWinking = false;
    if (now - _eyeState.right.lastWinkTs > WINK_DEBOUNCE_MS) {
      _eyeState.right.lastWinkTs = now;
      _winkCount++;
      _updateWinkUI();
      _triggerWinkFlash('RIGHT');
    }
  }
}

// ─── Canvas overlay ──────────────────────────────────────────────────────────
function _drawEyePoints(landmarks, canvasEl, ctx) {
  const W = canvasEl.width, H = canvasEl.height;
  const dot = (lm, color) => {
    ctx.beginPath();
    ctx.arc(lm.x * W, lm.y * H, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  };
  // Left eye landmarks (purple)
  [386, 374, 373, 380, 385, 387, 362, 263, 388, 390, 382, 381, 384]
    .forEach(i => dot(landmarks[i], 'rgba(200,0,255,0.8)'));
  // Right eye landmarks (white)
  [159, 145, 144, 153, 158, 160, 33, 133, 161, 163, 154, 155, 157]
    .forEach(i => dot(landmarks[i], 'rgba(255,255,255,0.8)'));
}

// ─── MediaPipe result callback ────────────────────────────────────────────────
function _onFaceMeshResults(results, canvasEl, ctx, videoEl) {
  // Sync canvas size once per resize
  if (canvasEl.width !== videoEl.videoWidth || canvasEl.height !== videoEl.videoHeight) {
    canvasEl.width  = videoEl.videoWidth  || 640;
    canvasEl.height = videoEl.videoHeight || 480;
  }
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  const distWarning  = _dom('distance-warning');
  const blockWarning = _dom('block-warning');
  const trackStatus  = _dom('tracking-status');

  // ── No face ──────────────────────────────────────────────────────────────
  if (!results.multiFaceLandmarks || !results.multiFaceLandmarks.length) {
    window._faceInRange = false;
    if (_gameActive || window.isCalibActive()) {
      if (distWarning) { distWarning.classList.remove('hidden'); distWarning.classList.add('flex'); }
    }
    if (_gameActive && trackStatus) trackStatus.textContent = '⚠️ No face – look into the camera';
    return;
  }

  const landmarks = results.multiFaceLandmarks[0];

  // ── Distance check ────────────────────────────────────────────────────────
  const eyeDist = Math.hypot(
    landmarks[263].x - landmarks[33].x,
    landmarks[263].y - landmarks[33].y
  );
  if (eyeDist < 0.14) {
    window._faceInRange = false;
    if (_gameActive || window.isCalibActive()) {
      if (distWarning) { distWarning.classList.remove('hidden'); distWarning.classList.add('flex'); }
    }
    return;
  }

  // Face in range – clear warnings
  window._faceInRange = true;
  if (distWarning) { distWarning.classList.add('hidden'); distWarning.classList.remove('flex'); }
  if (blockWarning) { blockWarning.classList.add('hidden'); blockWarning.classList.remove('flex'); }

  const rawL = _computeEAR(landmarks, LEFT_EYE_IDX);
  const rawR = _computeEAR(landmarks, RIGHT_EYE_IDX);

  if (_gameActive && trackStatus) {
    trackStatus.textContent = `✅ Tracking | L:${rawL.toFixed(2)} R:${rawR.toFixed(2)}`;
  }

  if (window.isCalibActive()) {
    // Feed raw values to calibration module
    window.onCalibFrame(rawL, rawR);
    // Still show EAR bars during calib for feedback
    const p = window.userProfile;
    _updateEARBars(
      _lerpScore(rawL, p.leftMin, p.leftMax),
      _lerpScore(rawR, p.rightMin, p.rightMax),
      rawL, rawR
    );
  } else {
    _processEARs(rawL, rawR);
  }

  _drawEyePoints(landmarks, canvasEl, ctx);
}

// ─── Timer ────────────────────────────────────────────────────────────────────
function _updateTimerUI() {
  const timerText    = _dom('timer-text');
  const timerBarFill = _dom('timer-bar-fill');

  const tStr = String(_timeLeft);
  if (_cache.timerText !== tStr) {
    _cache.timerText = tStr;
    if (timerText) timerText.textContent = _timeLeft;
    if (_timeLeft <= 10 && timerText) {
      timerText.style.color      = '#ff4444';
      timerText.style.textShadow = '0 0 20px rgba(255,68,68,0.9)';
      timerText.style.animation  = 'glowPulse 0.5s ease-in-out infinite';
    }
  }

  const pct   = (_timeLeft / GAME_DURATION_S) * 100;
  const pctW  = `${pct}%`;
  const bg    = pct > 60
    ? 'linear-gradient(90deg,#ff5252,#ff7043,#c800ff)'
    : pct > 25
      ? 'linear-gradient(90deg,#ff8800,#ff7043)'
      : 'linear-gradient(90deg,#ff2244,#ff6600)';

  _setWidth(timerBarFill, 'timerBarW', pctW);
  _setBg(timerBarFill, 'timerBarBg', bg);
}

function _startTimer() {
  _timeLeft = GAME_DURATION_S;
  _updateTimerUI();
  _timerHandle = setInterval(() => {
    _timeLeft--;
    _updateTimerUI();
    if (_timeLeft <= 0) { clearInterval(_timerHandle); endGame(); }
  }, 1000);
}

// ─── MediaPipe init ──────────────────────────────────────────────────────────
function _initFaceMesh(videoEl, canvasEl, ctx) {
  _faceMesh = new FaceMesh({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
  });
  _faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.55,
    minTrackingConfidence: 0.55,
  });
  _faceMesh.onResults(r => _onFaceMeshResults(r, canvasEl, ctx, videoEl));
}

// ─── Buzzer ───────────────────────────────────────────────────────────────────
function _playBuzzer() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const gn = ac.createGain(); gn.connect(ac.destination);
    [[880, 0, 0.18], [660, 0.2, 0.18], [440, 0.4, 0.35]].forEach(([freq, start, dur]) => {
      const osc = ac.createOscillator(); osc.type = 'square'; osc.frequency.value = freq;
      const g   = ac.createGain();
      g.gain.setValueAtTime(0.35, ac.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + start + dur);
      osc.connect(g); g.connect(gn);
      osc.start(ac.currentTime + start); osc.stop(ac.currentTime + start + dur + 0.05);
    });
  } catch (_) {}
  const bo = _dom('buzzer-overlay');
  if (bo) { bo.classList.remove('flash'); void bo.offsetWidth; bo.classList.add('flash'); }
}

// ─── Wrestling bell sound ────────────────────────────────────────────────────
function _playWrestlingBell() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const gn = ac.createGain();
    gn.connect(ac.destination);

    // 3 clean, metallic clangs at 0.0s, 0.28s, and 0.56s
    [0.0, 0.28, 0.56].forEach(start => {
      // Use 3 detuned frequencies to simulate a rich metallic bell resonance
      [880, 883, 1200].forEach((freq, idx) => {
        const osc = ac.createOscillator();
        const oscGain = ac.createGain();
        
        osc.type = idx === 2 ? 'sine' : 'triangle';
        osc.frequency.value = freq;
        
        // High frequency (1200Hz) has lower volume and faster decay for attack brightness
        const maxVol = idx === 2 ? 0.08 : 0.22;
        const decayTime = idx === 2 ? 0.35 : 1.1;
        
        oscGain.gain.setValueAtTime(0.0, ac.currentTime + start);
        oscGain.gain.linearRampToValueAtTime(maxVol, ac.currentTime + start + 0.008);
        oscGain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + start + decayTime);
        
        osc.connect(oscGain);
        oscGain.connect(gn);
        
        osc.start(ac.currentTime + start);
        osc.stop(ac.currentTime + start + decayTime + 0.05);
      });
    });
  } catch (_) {}
  const fo = _dom('fight-flash-overlay');
  if (fo) { fo.classList.remove('flash'); void fo.offsetWidth; fo.classList.add('flash'); }
}

// ─── Confetti ─────────────────────────────────────────────────────────────────
let _confettiInterval = null;
const _CONFETTI_COLORS = ['#ff5252','#ff7043','#c800ff','#ff44aa','#44ffcc','#500073','#ffffff'];

function _createConfettiBurst() {
  for (let i = 0; i < 60; i++) {
    const el    = document.createElement('div');
    el.className = 'confetti-piece';
    const color = _CONFETTI_COLORS[Math.floor(Math.random() * _CONFETTI_COLORS.length)];
    const dur   = 2.5 + Math.random() * 2;
    const delay = Math.random() * 1.5;
    el.style.cssText = `left:${Math.random()*100}vw;top:-20px;`
      + `width:${6+Math.random()*10}px;height:${8+Math.random()*12}px;`
      + `background:${color};transform:rotate(${Math.random()*360}deg);`
      + `--duration:${dur}s;--delay:${delay}s;`
      + `animation-delay:${delay}s;animation-duration:${dur}s;`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), (dur + delay + 0.5) * 1000);
  }
}

function _launchConfetti() {
  document.querySelectorAll('.confetti-piece').forEach(el => el.remove());
  _createConfettiBurst();
  if (_confettiInterval) clearInterval(_confettiInterval);
  _confettiInterval = setInterval(_createConfettiBurst, 1500);
}

function _stopConfetti() {
  if (_confettiInterval) clearInterval(_confettiInterval);
  document.querySelectorAll('.confetti-piece').forEach(el => el.remove());
}

// ─── Screen helpers ───────────────────────────────────────────────────────────
function _showScreen(id) {
  ['screen-welcome', 'screen-game', 'screen-reward'].forEach(sid => {
    const s = _dom(sid);
    if (s) s.classList.add('hidden');
  });
  const target = _dom(id);
  if (target) target.classList.remove('hidden');
}

async function _countdown321() {
  const elStatus = _dom('tracking-status');
  const overlay  = _dom('countdown-overlay');
  const numEl    = _dom('countdown-number');
  const labelEl  = _dom('countdown-label');
  
  if (overlay) overlay.classList.remove('hidden');

  const steps = [
    { text: 'READY', label: 'GET SET' },
    { text: '3', label: 'PREPARE YOUR EYES' },
    { text: '2', label: 'PREPARE YOUR EYES' },
    { text: '1', label: 'PREPARE YOUR EYES' },
    { text: 'GO! 🟡', label: 'WINK AS FAST AS YOU CAN!' }
  ];

  for (const step of steps) {
    if (elStatus) elStatus.textContent = step.text === 'READY' ? '✅ Ready!' : step.text;
    
    if (numEl) {
      numEl.textContent = step.text;
      numEl.classList.remove('countdown-pop');
      void numEl.offsetWidth; // Force DOM reflow to restart animation
      numEl.classList.add('countdown-pop');
      
      // Color-code GO! to glowing yellow, others to white-magenta
      if (step.text.includes('GO')) {
        numEl.style.color = '#ffff00';
        numEl.style.textShadow = '0 0 20px rgba(255,255,0,0.8), 0 0 40px rgba(255,160,0,0.6)';
      } else {
        numEl.style.color = '#ffffff';
        numEl.style.textShadow = '0 0 20px rgba(200,0,255,0.8), 0 0 40px rgba(255,82,82,0.6)';
      }
    }
    
    if (labelEl) labelEl.textContent = step.label;
    
    await _sleep(800);
  }

  // Smoothly fade out countdown overlay
  if (overlay) {
    overlay.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    overlay.style.opacity = '0';
    overlay.style.transform = 'scale(1.1)';
    await _sleep(300);
    overlay.classList.add('hidden');
    overlay.style.opacity = '';
    overlay.style.transform = '';
  }
}

// ─── Reset wink state ─────────────────────────────────────────────────────────
function _resetWinkState() {
  _winkCount = 0;
  _cache.winkCount = -1; // force next render
  _eyeState.left.wasWinking  = false;
  _eyeState.right.wasWinking = false;
  _eyeState.left.lastWinkTs  = 0;
  _eyeState.right.lastWinkTs = 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pauses the game (used by recalibration flow).
 */
function pauseGame() {
  _gameActive = false;
  if (_timerHandle) { clearInterval(_timerHandle); _timerHandle = null; }
}

/**
 * Begin the active game countdown + timer after calibration.
 */
async function beginGame() {
  _resetWinkState();
  window._recalibratingActive = false;
  _updateWinkUI();

  const trackStatus = _dom('tracking-status');
  if (trackStatus) trackStatus.textContent = '✅ Ready!';

  await _countdown321();

  _playWrestlingBell(); // Play the wrestling ring fight-start bell!
  _gameActive = true;
  _startTimer();

  if (trackStatus) trackStatus.textContent = '✅ Face detected – keep winking!';
}

/**
 * End the current game and show the reward screen.
 */
function endGame() {
  _gameActive = false;
  _playBuzzer();
  _stopCamera(); // Turn off the camera stream immediately!

  const finalWinks    = _winkCount;
  const finalDiscount = Math.min(Math.floor(finalWinks / 3), MAX_DISCOUNT_PCT);
  _promoCode          = `ZEPTOWINK${finalDiscount}`;

  const rwc = _dom('result-wink-count');
  const rd  = _dom('result-discount');
  const pcd = _dom('promo-code-display');
  if (rwc) rwc.textContent = finalWinks;
  if (rd)  rd.textContent  = `${finalDiscount}% OFF`;
  if (pcd) pcd.textContent = _promoCode;

  setTimeout(() => { _showScreen('screen-reward'); _launchConfetti(); }, 900);
}

/**
 * Start challenge: init MediaPipe, camera, then calibration, then game.
 */
async function startChallenge() {
  const btn = _dom('btn-start');
  const err = _dom('welcome-error');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Starting…'; }
  if (err) err.classList.add('hidden');

  try {
    _showScreen('screen-game');

    const videoEl  = _dom('webcam-video');
    const canvasEl = _dom('overlay-canvas');
    const ctx      = canvasEl.getContext('2d');
    const tsEl     = _dom('tracking-status');
    if (tsEl) tsEl.textContent = '🧠 Loading face-tracking model…';

    _initFaceMesh(videoEl, canvasEl, ctx);

    _camera = new Camera(videoEl, {
      onFrame: async () => {
        if (_faceMesh && videoEl.readyState >= 2) {
          await _faceMesh.send({ image: videoEl });
        }
      },
      width: 640, height: 480,
    });
    await _camera.start();

    await _sleep(1500); // warm-up
    window._calibFaceReady = false;
    if (tsEl) tsEl.textContent = '🎯 Starting calibration…';

    await startCalibration();   // defined in calibration.js
    await beginGame();          // kick off the game

  } catch (err_) {
    _showScreen('screen-welcome');
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Start Challenge'; }
    if (err) {
      err.textContent = `❌ ${err_.message || 'Camera access required.'}`;
      err.classList.remove('hidden');
    }
    console.error(err_);
  }
}

// ─── Camera cleanup ──────────────────────────────────────────────────────────
function _stopCamera() {
  // 1. Force stop all tracks on intercepted streams to resolve MediaPipe track leak
  while (_activeStreams.length > 0) {
    const stream = _activeStreams.pop();
    if (stream && typeof stream.getTracks === 'function') {
      stream.getTracks().forEach(track => {
        try { track.stop(); } catch (_) {}
      });
    }
  }

  // 2. Stop tracks on video element
  const videoEl = _dom('webcam-video');
  if (videoEl && videoEl.srcObject) {
    const stream = videoEl.srcObject;
    if (stream && typeof stream.getTracks === 'function') {
      stream.getTracks().forEach(track => {
        try { track.stop(); } catch (_) {}
      });
    }
    videoEl.srcObject = null;
  }
  if (_camera)   { try { _camera.stop();    } catch (_) {} _camera   = null; }
  if (_faceMesh) { try { _faceMesh.close(); } catch (_) {} _faceMesh = null; }
}

/**
 * Reset everything and go back to the welcome screen.
 */
function resetToWelcome() {
  clearInterval(_timerHandle);
  _gameActive  = false;
  _promoCode   = '';
  window._calibFaceReady      = false;
  window._recalibratingActive = false;
  _stopConfetti();
  _resetWinkState();

  _stopCamera();

  // Reset UI
  const wcd = _dom('wink-count-display');
  const tt  = _dom('timer-text');
  const tbf = _dom('timer-bar-fill');
  const ld  = _dom('live-discount');
  const ts  = _dom('tracking-status');
  const rb  = _dom('btn-recalibrate');
  const co  = _dom('calib-overlay');

  if (wcd) wcd.textContent     = '0';
  if (tt)  {
    tt.textContent   = GAME_DURATION_S;
    tt.style.color   = '#ffffff';
    tt.style.textShadow = '0 0 15px rgba(255,255,255,0.5)';
    tt.style.animation  = 'none';
  }
  if (tbf) { tbf.style.width   = '100%'; tbf.style.background = 'linear-gradient(90deg,#ff5252,#ff7043,#c800ff)'; }
  if (ld)  ld.textContent      = '0% Off';
  if (ts)  ts.textContent      = '🔍 Initializing face tracking…';
  if (rb)  rb.style.display    = 'none';
  if (co)  co.classList.add('hidden');

  // Reset cache
  Object.keys(_cache).forEach(k => { _cache[k] = k === 'winkCount' ? -1 : ''; });

  const btn = _dom('btn-start');
  if (btn) { btn.disabled = false; btn.textContent = '🚀 Start Challenge'; }

  _showScreen('screen-welcome');
}

/**
 * Copy promo code to clipboard.
 */
async function copyPromoCode() {
  const pcd  = _dom('promo-code-display');
  const code = (pcd && pcd.textContent) || _promoCode;
  try {
    await navigator.clipboard.writeText(code);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = code; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  const toast = _dom('copy-toast');
  if (toast) {
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }
}

// ─── Expose globals for HTML onclick= handlers ────────────────────────────────
window.startChallenge  = startChallenge;
window.beginGame       = beginGame;
window.pauseGame       = pauseGame;
window.endGame         = endGame;
window.resetToWelcome  = resetToWelcome;
window.copyPromoCode   = copyPromoCode;
