import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fft, ifft, toHarmonics, evaluateHarmonics } from '../src/fourier.js';
import { createScene } from '../src/renderer.js';

const close = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
};

test('a shifted circle has only its DC and positive first harmonic', () => {
  const points = Array.from({ length: 64 }, (_, i) => [
    2 + 3 * Math.cos(2 * Math.PI * i / 64),
    -5 + 3 * Math.sin(2 * Math.PI * i / 64)
  ]);
  const spectrum = fft(points);
  close(spectrum[0][0], 128);
  close(spectrum[0][1], -320);
  close(spectrum[1][0], 192);
  close(spectrum[1][1], 0);
  for (const [real, imag] of spectrum.slice(2)) close(Math.hypot(real, imag), 0);
  const harmonics = toHarmonics(points, 2);
  assert.deepEqual(harmonics.map(h => h[0]), [0, 1]);
  close(harmonics[0][1], 2);
  close(harmonics[0][2], -5);
  close(harmonics[1][1], 3);
});

test('a constant signal remains constant at every phase', () => {
  const points = Array.from({ length: 32 }, () => ({ x: 4, y: -7 }));
  const harmonics = toHarmonics(points);
  assert.deepEqual(harmonics[0], [0, 4, -7]);
  for (const phase of [0, 0.125, 0.63, 1, 2.4]) {
    const point = evaluateHarmonics(harmonics, phase);
    close(point.x, 4);
    close(point.y, -7);
  }
});

test('FFT and inverse FFT round-trip complex points without changing the input', () => {
  const points = Array.from({ length: 128 }, (_, i) => [
    Math.sin(i * 0.71) + i / 17, Math.cos(i * 0.23) - i / 31
  ]);
  const original = structuredClone(points);
  const restored = ifft(fft(points));
  restored.forEach(([x, y], i) => {
    close(x, points[i][0]);
    close(y, points[i][1]);
  });
  assert.deepEqual(points, original);
  assert.throws(() => fft([[0, 0], [1, 0], [2, 0]]), RangeError);
});

function recordingContext() {
  let path = [];
  let dash = [];
  return {
    strokes: [],
    save() {}, restore() {}, fillRect() {}, fill() {},
    setLineDash(value) { dash = [...value]; },
    beginPath() { path = []; },
    moveTo(x, y) { path.push(['move', x, y]); },
    lineTo(x, y) { path.push(['line', x, y]); },
    arc(x, y, radius) { path.push(['arc', x, y, radius]); },
    closePath() { path.push(['close']); },
    stroke() { this.strokes.push({ path: [...path], dash: [...dash] }); }
  };
}

const word = JSON.parse(readFileSync(new URL('../data/word.json', import.meta.url), 'utf8'));
const scene = createScene(word, { fit: 'word', showEpicycles: false, showGuides: false });
const palette = { bg: '#101418', fg: '#edf2f7', muted: '#718096', accent: '#6fb2e8' };
const draw = (phase, transfers = true, ctx = recordingContext()) =>
  scene.draw(ctx, 736, 380, phase, palette, transfers);

test('the complete word uses one unchanged Fourier phase and closes exactly', () => {
  const start = draw(0);
  const end = draw(1);
  assert.deepEqual(start.point, end.point);
  assert.equal(end.complete, true);
  for (const phase of [0.071, 0.253, 0.617, 0.92]) {
    const actual = draw(phase);
    const expected = evaluateHarmonics(word.harmonics, phase);
    close(actual.point.x, expected.x, 1e-9);
    close(actual.point.y, expected.y, 1e-9);
    assert.equal(actual.phase, phase);
  }
});

test('continuous mode draws one solid path; hiding bridges only masks its trace', () => {
  const full = recordingContext();
  const masked = recordingContext();
  const fullResult = draw(1, true, full);
  const maskedResult = draw(1, false, masked);
  assert.deepEqual(fullResult.point, maskedResult.point);
  assert.equal(fullResult.phase, maskedResult.phase);
  assert.equal(full.strokes.length, 2);
  assert.equal(masked.strokes.length, 1);
  assert.equal(full.strokes[0].path.filter(p => p[0] === 'move').length, 1);
  assert.equal(full.strokes[0].path.filter(p => p[0] === 'line').length, fullResult.samples + 1);
  assert.deepEqual(full.strokes[0].dash, []);
  assert.deepEqual(full.strokes[1], masked.strokes[0]);
  const inkSections = masked.strokes[0].path.filter(p => p[0] === 'move').length;
  assert.equal(inkSections, word.intervals.filter(interval => interval.ink).length);
  assert.ok(inkSections > 1);
});
