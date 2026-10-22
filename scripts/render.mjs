import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createCanvas } from '@napi-rs/canvas';
import gifenc from 'gifenc';
import { createScene } from '../src/renderer.js';
import { renderSvg } from '../src/svg.js';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const {values} = parseArgs({options: {
  theme: {type:'string', default:'both'},
  width: {type:'string', default:'800'},
  fps: {type:'string', default:'25'},
  seconds: {type:'string', default:'22'},
  mode: {type:'string', default:'continuous'}
}});
const width = Number(values.width);
const height = Math.round(width * 380 / 736);
const fps = Number(values.fps);
const seconds = Number(values.seconds);
if (!Number.isInteger(width) || width < 320 || width > 1920 || !Number.isInteger(fps) || fps < 5 || fps > 50 || !Number.isFinite(seconds) || seconds < 2 || seconds > 120) {
  throw new Error('Use width 320–1920, fps 5–50, seconds 2–120.');
}
if (!['dark', 'light', 'both'].includes(values.theme) || !['continuous', 'masked'].includes(values.mode)) {
  throw new Error('Theme: dark/light/both. Mode: continuous/masked.');
}

const root = new URL('../', import.meta.url);
const data = JSON.parse(await readFile(new URL('data/word.json', root), 'utf8'));
const scene = createScene(data, {fit:'word', wordWidthRatio:0.82, endConstructionOpacity:0.9});
const themes = {
  dark: {bg:'#0d1117', fg:'#e6edf3', muted:'#8b949e', accent:'#7bc9e8'},
  light: {bg:'#ffffff', fg:'#1f2328', muted:'#68727e', accent:'#267da4'}
};
const selected = values.theme === 'both' ? ['dark', 'light'] : [values.theme];
const showTransfers = values.mode === 'continuous';
const canvas = createCanvas(width, height);
const context = canvas.getContext('2d');
const frameCount = Math.round(seconds * fps);
await mkdir(new URL('assets/', root), {recursive:true});

for (const theme of selected) {
  const palette = themes[theme];
  const gif = GIFEncoder();
  let firstFrame = true;
  let previousFrame;
  const samples = [];
  for (const phase of [0, 0.2, 0.45, 0.7, 1]) {
    scene.draw(context, width, height, phase, palette, showTransfers);
    const rgba = context.getImageData(0, 0, width, height).data;
    for (let i = 0; i < rgba.length; i += 16) samples.push(...rgba.subarray(i, i + 4));
  }
  // One palette prevents the colors from flickering between frames.
  const colors = quantize(new Uint8Array(samples), 127);
  const gifColors = [[0, 0, 0], ...colors];

  function writeFrame(phase, delay) {
    scene.draw(context, width, height, phase, palette, showTransfers);
    const rgba = context.getImageData(0, 0, width, height).data;
    const current = applyPalette(rgba, colors).map(index => index + 1);
    const pixels = current.slice();
    // Transparent pixels keep the previous frame, reducing the GIF size.
    if (previousFrame) {
      for (let i = 0; i < pixels.length; i++) {
        if (current[i] === previousFrame[i]) pixels[i] = 0;
      }
    }
    gif.writeFrame(pixels, width, height, {
      ...(firstFrame ? {palette:gifColors} : {}),
      transparent:true, transparentIndex:0, delay, repeat:0, dispose:1
    });
    firstFrame = false;
    previousFrame = current;
  }

  writeFrame(1, 1200);
  for (let i = 0; i <= frameCount; i++) {
    const phase = i / frameCount;
    const delay = Math.round((i + 1) * 100 / fps) * 10 - Math.round(i * 100 / fps) * 10;
    writeFrame(phase, i === frameCount ? 1800 : delay);
    if (i % (fps * 5) === 0) console.log(`${theme}: ${Math.round(phase * 100)}%`);
  }
  gif.finish();
  const gifBytes = gif.bytes();
  await writeFile(new URL(`assets/profile-${theme}.gif`, root), gifBytes);
  await writeFile(new URL(`assets/poster-${theme}.png`, root), canvas.toBuffer('image/png'));
  await writeFile(new URL(`assets/signature-${theme}.svg`, root), renderSvg(scene, {
    width, height, progress:1, palette, showTransfers
  }));
  console.log(`assets/profile-${theme}.gif — ${(gifBytes.length / 1024 / 1024).toFixed(2)} MiB`);
}
