/**
 * calibration.js – Zepto Wink Challenge
 * Handles the calibration wizard UI and produces window.userProfile.
 * Globals consumed: window._calibFaceReady, window._faceInRange
 * Globals produced: window.userProfile = { leftMin, leftMax, rightMin, rightMax }
 */
'use strict';

// ─── Ring circumference (r=35 circle) ────────────────────────────────────────
const RING_CIRC = 2 * Math.PI * 35; // ≈ 219.9

// ─── Calibration step metadata ────────────────────────────────────────────────
const CALIB_STEP_META = [
  {
    dotIdx: 0, icon: '👀', title: 'EYE CALIBRATION',
    subtitle: 'MOVE <span class="calib-highlight">closer to the CAMERA</span> with <span class="calib-highlight">BOTH eyes NATURALLYopen</span>  for better calibration',
    durationMs: 3500,
  },
];

// ─── Internal calibration state ───────────────────────────────────────────────
const _calibInternal = {
  phase: 'idle',     // 'idle' | 'baseline' | 'done'
  leftSamples: [],
  rightSamples: [],
  active: false,
};

// ─── Public profile (set after calibration completes / on skip) ───────────────
window.userProfile = {
  leftMin: 0.18,   // default fallback values
  leftMax: 0.32,
  rightMin: 0.18,
  rightMax: 0.32,
  calibrated: false,
};

// ─── DOM refs (resolved lazily so this file can load before DOM is ready) ─────
function _dom(id) { return document.getElementById(id); }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function _calibSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function _setCalibDot(activeIdx) {
  for (let i = 0; i < 3; i++) {
    const dot = _dom(`cdot-${i}`);
    if (!dot) continue;
    dot.className = 'calib-dot';
    if (i < activeIdx) dot.classList.add('done');
    if (i === activeIdx) dot.classList.add('active');
  }
}

function _setCalibStatus(text, cls = '') {
  const el = _dom('calib-status');
  if (!el) return;
  el.className = '';
  if (cls) el.classList.add(cls);
  el.textContent = text;
}

function _updateCalibRing(progress /* 0–1 */) {
  const fill = _dom('calib-ring-fill');
  if (fill) fill.style.strokeDashoffset = RING_CIRC * (1 - progress);
}

function _updateCalibEarPills(lEAR, rEAR) {
  const elL = _dom('calib-ear-left');
  const elR = _dom('calib-ear-right');
  const pL = _dom('calib-pill-left');
  const pR = _dom('calib-pill-right');
  if (elL) elL.textContent = lEAR.toFixed(3);
  if (elR) elR.textContent = rEAR.toFixed(3);
  if (pL) pL.className = 'calib-ear-pill ear-open';
  if (pR) pR.className = 'calib-ear-pill ear-open';
}

// ─── Phase runner ─────────────────────────────────────────────────────────────
function _runCalibPhase(stepIdx, phaseId) {
  return new Promise(resolve => {
    const meta = CALIB_STEP_META[stepIdx];
    _calibInternal.phase = phaseId;

    _setCalibDot(stepIdx);

    const icon = _dom('calib-icon');
    const title = _dom('calib-title');
    const subtitle = _dom('calib-subtitle');
    const sec = _dom('calib-ring-sec');
    const fill = _dom('calib-ring-fill');

    if (icon) icon.textContent = meta.icon;
    if (title) title.textContent = meta.title;
    if (subtitle) subtitle.innerHTML = meta.subtitle;

    let timeLeftMs = meta.durationMs;
    if (sec) sec.textContent = Math.ceil(timeLeftMs / 1000);

    _setCalibStatus('⏺ Capturing…', 'active');

    // Reset ring
    if (fill) {
      fill.setAttribute('class', 'calib-ring-fill');
      fill.style.transition = 'none';
      fill.style.strokeDashoffset = RING_CIRC;
    }

    const LOOP_MS = 100;
    const tick = setInterval(() => {
      if (!window._faceInRange) return; // pause if face is out of range

      timeLeftMs -= LOOP_MS;
      if (sec) sec.textContent = Math.max(0, Math.ceil(timeLeftMs / 1000));
      _updateCalibRing(Math.max(0, 1 - timeLeftMs / meta.durationMs));

      if (timeLeftMs <= 0) {
        clearInterval(tick);
        if (fill) fill.style.strokeDashoffset = 0;
        _setCalibStatus('✅ Got it!', 'success');
        setTimeout(resolve, 350);
      }
    }, LOOP_MS);
  });
}

// ─── Threshold computation ────────────────────────────────────────────────────
function _finishCalibration() {
  const avg = arr => arr.length
    ? arr.reduce((a, b) => a + b, 0) / arr.length
    : 0.28;

  const lOpen = avg(_calibInternal.leftSamples);
  const rOpen = avg(_calibInternal.rightSamples);

  // Use a fixed absolute drop below the open baseline for the "closed" floor.
  // Old formula (lOpen * 0.60) collapses to near 0 for narrow-eyed users (e.g.
  // 0.30 * 0.60 = 0.18) leaving almost no detection window.
  // New formula: open - 0.13 gives a reliable ~40 % of open-eye EAR as floor.
  const CLOSE_DROP = 0.13;
  window.userProfile = {
    leftMin: Math.max(lOpen - CLOSE_DROP, 0.08),  // floor at 0.08
    leftMax: lOpen,
    rightMin: Math.max(rOpen - CLOSE_DROP, 0.08),
    rightMax: rOpen,
    leftOpen: lOpen,   // raw reference kept for asymmetry guard
    rightOpen: rOpen,
    calibrated: true,
  };

  console.log(
    `[Calib] L open=${lOpen.toFixed(3)} → min=${window.userProfile.leftMin.toFixed(3)}`,
    `R open=${rOpen.toFixed(3)} → min=${window.userProfile.rightMin.toFixed(3)}`
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Called every frame during calibration by the tracking module.
 * @param {number} lEAR  raw left-eye EAR
 * @param {number} rEAR  raw right-eye EAR
 */
function onCalibFrame(lEAR, rEAR) {
  window._calibFaceReady = true;
  _updateCalibEarPills(lEAR, rEAR);
  if (_calibInternal.phase === 'baseline') {
    _calibInternal.leftSamples.push(lEAR);
    _calibInternal.rightSamples.push(rEAR);
  }
}

/**
 * Full calibration wizard. Resolves when the overlay is dismissed.
 */
async function startCalibration() {
  _calibInternal.active = true;
  _calibInternal.phase = 'idle';
  _calibInternal.leftSamples = [];
  _calibInternal.rightSamples = [];
  window.userProfile.calibrated = false;
  window._calibFaceReady = false;

  const overlay = _dom('calib-overlay');
  if (overlay) overlay.classList.remove('hidden', 'fade-out');
  _setCalibStatus('⏳ Waiting for face…');
  _setCalibDot(0);

  // Wait until the tracking loop signals a face is present
  await new Promise(resolve => {
    const poll = setInterval(() => {
      if (window._calibFaceReady) { clearInterval(poll); resolve(); }
    }, 100);
  });

  // Single phase: baseline open-eye sampling
  await _runCalibPhase(0, 'baseline');
  _finishCalibration();

  // Success feedback
  _setCalibStatus('✅ Calibration complete!', 'success');
  const fill = _dom('calib-ring-fill');
  if (fill) { fill.setAttribute('class', 'calib-ring-fill success'); fill.style.strokeDashoffset = 0; }
  for (let i = 0; i < 3; i++) {
    const dot = _dom(`cdot-${i}`);
    if (dot) dot.className = 'calib-dot done';
  }

  await _calibSleep(800);

  if (overlay) { overlay.classList.add('fade-out'); }
  await _calibSleep(450);
  if (overlay) { overlay.classList.add('hidden'); overlay.classList.remove('fade-out'); }

  _calibInternal.active = false;
  const recal = _dom('btn-recalibrate');
  if (recal) recal.style.display = 'inline';
}

/**
 * Bypass calibration and use default fallback thresholds.
 */
function skipCalibration() {
  _calibInternal.active = false;
  _calibInternal.phase = 'idle';
  // Keep defaults already set on window.userProfile
  window.userProfile.calibrated = false;

  const overlay = _dom('calib-overlay');
  if (overlay) overlay.classList.add('hidden');

  const recal = _dom('btn-recalibrate');
  if (recal) recal.style.display = 'inline';
}

/**
 * Restart calibration from the game screen (resets game state too).
 */
async function restartCalibration() {
  try {
    // Signal game module to pause
    window._recalibratingActive = true;
    if (typeof pauseGame === 'function') pauseGame();

    window._calibFaceReady = false;
    const recal = _dom('btn-recalibrate');
    if (recal) recal.style.display = 'none';

    await startCalibration();

    // Signal game module to resume
    window._recalibratingActive = false;
    if (typeof beginGame === 'function') beginGame();

  } catch (err) {
    console.error('[Recalibrate] Error:', err);
    skipCalibration();
    window._recalibratingActive = false;
  }
}

/**
 * Returns true while the calibration wizard is active.
 */
function isCalibActive() {
  return _calibInternal.active;
}

// ─── Expose globals for HTML onclick= handlers ────────────────────────────────
window.startCalibration = startCalibration;
window.skipCalibration = skipCalibration;
window.restartCalibration = restartCalibration;
window.onCalibFrame = onCalibFrame;
window.isCalibActive = isCalibActive;
