import { evaluateHarmonics } from './fourier.js';

const TAU = Math.PI * 2;
const clamp01 = value => Math.max(0, Math.min(1, value));

function beginStroke(ctx, color, width, opacity) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = opacity;
  ctx.beginPath();
}

export function createScene(data, options = {}) {
  if (!(data?.width > 0) || !(data?.height > 0) || !Array.isArray(data.harmonics)) {
    throw new TypeError('A positive word bounding box and complex harmonics are required.');
  }
  const harmonics = [];
  let dcX = 0;
  let dcY = 0;
  let dcCount = 0;
  let maxFrequency = 0;
  let derivativeSum = 0;
  for (const [frequency, real, imag] of data.harmonics) {
    if (!Number.isInteger(frequency) || !Number.isFinite(real) || !Number.isFinite(imag)) {
      throw new TypeError('Harmonics need integer frequencies and finite complex amplitudes.');
    }
    if (frequency === 0) {
      dcX += real;
      dcY += imag;
      dcCount++;
    } else {
      const amplitude = Math.hypot(real, imag);
      harmonics.push({ frequency, real, imag, amplitude });
      maxFrequency = Math.max(maxFrequency, Math.abs(frequency));
      derivativeSum += Math.abs(frequency) * amplitude;
    }
  }
  harmonics.sort((a, b) => b.amplitude - a.amplitude
    || Math.abs(a.frequency) - Math.abs(b.frequency) || a.frequency - b.frequency);

  const samples = 2 ** Math.ceil(Math.log2(Math.max(8192, 2 * maxFrequency + 1)));
  const pathX = new Float64Array(samples + 1);
  const pathY = new Float64Array(samples + 1);
  let minX = -dcX;
  let maxX = data.width - dcX;
  let minY = -dcY;
  let maxY = data.height - dcY;

  // Cache the trace and measure every circle over the full cycle.
  for (const harmonic of harmonics) {
    const angle = TAU * harmonic.frequency / samples;
    const rotationX = Math.cos(angle);
    const rotationY = Math.sin(angle);
    let cosine = 1;
    let sine = 0;
    for (let i = 0; i < samples; i++) {
      const x = pathX[i];
      const y = pathY[i];
      minX = Math.min(minX, x - harmonic.amplitude);
      maxX = Math.max(maxX, x + harmonic.amplitude);
      minY = Math.min(minY, y - harmonic.amplitude);
      maxY = Math.max(maxY, y + harmonic.amplitude);
      pathX[i] = x + harmonic.real * cosine - harmonic.imag * sine;
      pathY[i] = y + harmonic.real * sine + harmonic.imag * cosine;
      const nextCosine = cosine * rotationX - sine * rotationY;
      sine = sine * rotationX + cosine * rotationY;
      cosine = nextCosine;
    }
  }
  pathX[samples] = pathX[0];
  pathY[samples] = pathY[0];

  // Bound the motion between samples: |z'(t)| <= 2π sum(|k c[k]|).
  const allowance = Math.PI * derivativeSum / samples + 1e-6;
  minX -= allowance;
  maxX += allowance;
  minY -= allowance;
  maxY += allowance;
  const radiusX = Math.max(-minX, maxX);
  const radiusY = Math.max(-minY, maxY);
  const coefficients = harmonics.map(h => [h.frequency, h.real, h.imag]);
  const evaluate = phase => evaluateHarmonics(coefficients, phase);

  const intervals = [];
  let cursor = 0;
  for (const source of [...(data.intervals || [])].sort((a, b) => a.start - b.start)) {
    const start = clamp01(Number(source.start));
    const end = clamp01(Number(source.end));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start < cursor - 1e-9) {
      throw new TypeError('Ink intervals must be finite, ordered, and non-overlapping.');
    }
    if (start > cursor + 1e-12) intervals.push({ start: cursor, end: start, ink: false });
    if (end > start) intervals.push({ start, end, ink: Boolean(source.ink) });
    cursor = end;
  }
  if (!intervals.length) intervals.push({ start: 0, end: 1, ink: true });
  else if (cursor < 1) intervals.push({ start: cursor, end: 1, ink: false });
  for (const interval of intervals) {
    interval.startPoint = evaluate(interval.start);
    interval.endPoint = evaluate(interval.end);
    interval.firstSample = Math.floor(interval.start * samples) + 1;
    interval.lastSample = Math.floor(interval.end * samples);
  }
  const chainX = new Float64Array(harmonics.length + 1);
  const chainY = new Float64Array(harmonics.length + 1);

  function appendInterval(ctx, interval, phase, tip, anchorX, anchorY, scale) {
    const end = Math.min(interval.end, phase);
    if (end <= interval.start) return;
    ctx.moveTo(anchorX + interval.startPoint.x * scale, anchorY + interval.startPoint.y * scale);
    const last = Math.min(interval.lastSample, Math.floor(end * samples));
    for (let i = interval.firstSample; i <= last; i++) {
      ctx.lineTo(anchorX + pathX[i] * scale, anchorY + pathY[i] * scale);
    }
    const point = end === interval.end ? interval.endPoint : tip;
    ctx.lineTo(anchorX + point.x * scale, anchorY + point.y * scale);
  }

  return {
    options,
    draw(ctx, width, height, progress, palette, showTransfers = true) {
      const w = Math.max(1, Number(width) || 1);
      const h = Math.max(1, Number(height) || 1);
      const phase = clamp01(Number(progress) || 0);
      const complete = phase === 1;
      const margin = Math.max(12, Math.min(24, Math.min(w, h) * 0.055));
      const anchorX = w / 2;
      const anchorY = h / 2;
      const fit = options.fit === 'word' ? 'word' : 'construction';
      const widthRatio = Number.isFinite(options.wordWidthRatio)
        ? Math.max(0.1, Math.min(0.96, options.wordWidthRatio)) : 0.82;
      const scale = fit === 'word'
        ? Math.min(w * widthRatio / data.width, Math.max(1, h - margin * 2) / data.height)
        : Math.min(Math.max(1, w - margin * 2) / (2 * radiusX), Math.max(1, h - margin * 2) / (2 * radiusY));
      const angle = TAU * (complete ? 0 : phase);
      chainX[0] = 0;
      chainY[0] = 0;
      let visibleCircles = 0;
      for (let i = 0; i < harmonics.length; i++) {
        const harmonic = harmonics[i];
        const cosine = Math.cos(angle * harmonic.frequency);
        const sine = Math.sin(angle * harmonic.frequency);
        chainX[i + 1] = chainX[i] + harmonic.real * cosine - harmonic.imag * sine;
        chainY[i + 1] = chainY[i] + harmonic.real * sine + harmonic.imag * cosine;
        if (harmonic.amplitude * scale > 1.5) visibleCircles++;
      }
      const tip = { x: chainX[harmonics.length], y: chainY[harmonics.length] };
      const tipX = anchorX + tip.x * scale;
      const tipY = anchorY + tip.y * scale;
      let activeInterval = intervals.findIndex(interval => phase < interval.end);
      if (activeInterval < 0) activeInterval = intervals.length - 1;
      const endOpacity = Number.isFinite(options.endConstructionOpacity)
        ? clamp01(options.endConstructionOpacity) : 0.9;
      const constructionOpacity = complete ? endOpacity : 1;
      const showConstruction = options.showEpicycles !== false && constructionOpacity > 0;

      ctx.save();
      ctx.globalAlpha = 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, w, h);

      if (!complete && options.showGuides !== false) {
        beginStroke(ctx, palette.muted, 0.55, 0.18);
        for (const points of data.originals || []) {
          if (!points.length) continue;
          ctx.moveTo(anchorX + (points[0][0] - dcX) * scale, anchorY + (points[0][1] - dcY) * scale);
          for (let i = 1; i < points.length; i++) {
            ctx.lineTo(anchorX + (points[i][0] - dcX) * scale, anchorY + (points[i][1] - dcY) * scale);
          }
          ctx.closePath();
        }
        ctx.stroke();
      }
      if (showConstruction) {
        beginStroke(ctx, palette.accent, 1.05, 0.76 * constructionOpacity);
        for (let i = 0; i < harmonics.length; i++) {
          const radius = harmonics[i].amplitude * scale;
          if (radius <= 1.5) continue;
          const x = anchorX + chainX[i] * scale;
          const y = anchorY + chainY[i] * scale;
          ctx.moveTo(x + radius, y);
          ctx.arc(x, y, radius, 0, TAU);
        }
        ctx.stroke();
        beginStroke(ctx, palette.fg, 0.8, 0.45 * constructionOpacity);
        ctx.moveTo(anchorX, anchorY);
        for (let i = 1; i < chainX.length; i++) {
          ctx.lineTo(anchorX + chainX[i] * scale, anchorY + chainY[i] * scale);
        }
        ctx.stroke();
      }

      // Both modes use the same series. The mask only hides bridge strokes.
      if (showTransfers && phase > 0) {
        beginStroke(ctx, palette.fg, 0.95, 0.75);
        ctx.moveTo(anchorX + pathX[0] * scale, anchorY + pathY[0] * scale);
        const last = Math.min(samples, Math.floor(phase * samples));
        for (let i = 1; i <= last; i++) {
          ctx.lineTo(anchorX + pathX[i] * scale, anchorY + pathY[i] * scale);
        }
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
      }
      beginStroke(ctx, palette.fg, Math.max(1.05, Math.min(1.4, w / 620)), 1);
      for (const interval of intervals) {
        if (interval.start >= phase) break;
        if (interval.ink) appendInterval(ctx, interval, phase, tip, anchorX, anchorY, scale);
      }
      ctx.stroke();

      if (showConstruction) {
        ctx.globalAlpha = 0.65 * constructionOpacity;
        ctx.fillStyle = palette.muted;
        ctx.beginPath();
        ctx.arc(anchorX, anchorY, 1.65, 0, TAU);
        ctx.fill();
      }
      if (!complete) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = palette.accent;
        ctx.beginPath();
        ctx.arc(tipX, tipY, 2.1, 0, TAU);
        ctx.fill();
      }
      ctx.restore();

      const screenBounds = {
        left: anchorX + minX * scale, right: anchorX + maxX * scale,
        top: anchorY + minY * scale, bottom: anchorY + maxY * scale
      };
      return {
        progress: phase, phase, complete, ink: intervals[activeInterval].ink, activeInterval,
        tip: { x: tipX, y: tipY }, point: { x: dcX + tip.x, y: dcY + tip.y },
        anchor: { x: anchorX, y: anchorY }, dc: { x: dcX, y: dcY }, scale, fit,
        harmonics: harmonics.length + dcCount,
        visibleCircles: showConstruction ? visibleCircles : 0,
        resolvableCircles: visibleCircles, samples, maxFrequency,
        wordBounds: {
          left: anchorX - dcX * scale, top: anchorY - dcY * scale,
          width: data.width * scale, height: data.height * scale
        },
        constructionBounds: screenBounds,
        circlesClipped: screenBounds.left < 0 || screenBounds.top < 0
          || screenBounds.right > w || screenBounds.bottom > h,
        constructionOpacity: showConstruction ? constructionOpacity : 0,
        rmsErrorPixels: Number(data.metrics?.rmsError) * scale || 0,
        maxErrorPixels: Number(data.metrics?.maxError) * scale || 0
      };
    }
  };
}
