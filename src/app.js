import { createScene } from './renderer.js';
import { renderSvg } from './svg.js';

export function startApp(data) {
  const canvas = document.getElementById('signatureCanvas');
  const context = canvas.getContext('2d');
  const play = document.getElementById('playPause');
  const mode = document.getElementById('traceMode');
  const theme = document.getElementById('themeMode');
  const speed = document.getElementById('playbackSpeed');
  const timeline = document.getElementById('timeline');
  const progressLabel = document.getElementById('progressLabel');
  const status = document.getElementById('statusMessage');
  const darkTheme = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const scene = createScene(data, {
    fit: 'word',
    wordWidthRatio: 0.82,
    endConstructionOpacity: 0.9
  });

  const duration = 22;
  let progress = 1;
  let playing = false;
  let frame = 0;
  let lastTime = 0;
  let width = 736;
  let height = 380;
  let pixelRatio = 1;
  let palette;

  function readPalette() {
    const style = getComputedStyle(document.documentElement);
    const color = name => style.getPropertyValue(name).trim();
    palette = {
      bg: color('--canvas-bg'),
      fg: color('--ink'),
      muted: color('--muted'),
      accent: color('--geometry')
    };
  }

  function draw() {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    scene.draw(context, width, height, progress, palette, mode.value === 'continuous');
    timeline.value = progress;
    progressLabel.value = Math.round(progress * 100) + '%';
    timeline.setAttribute('aria-valuetext', progressLabel.value);
  }

  function resize() {
    const box = canvas.getBoundingClientRect();
    width = Math.max(1, box.width);
    height = Math.max(1, box.height);
    pixelRatio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    draw();
  }

  function updateStatus() {
    const trace = mode.value === 'continuous' ? 'Непрерывная линия' : 'Перо поднято на переходах';
    const state = playing ? 'Рисование' : progress === 1 ? 'Готово' : 'Пауза';
    status.textContent = state + ' · ' + trace;
  }

  function updateButton() {
    play.textContent = playing ? 'Пауза' : progress === 1 ? 'Нарисовать ещё раз' : 'Продолжить';
    if (reducedMotion.matches) play.textContent = progress === 1 ? 'Начать по шагам' : 'Следующий шаг';
    play.setAttribute('aria-pressed', String(playing));
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(frame);
    updateButton();
    updateStatus();
  }

  function tick(now) {
    if (!playing) return;
    progress = Math.min(1, progress + (now - lastTime) / 1000 * Number(speed.value) / duration);
    lastTime = now;
    draw();
    if (progress === 1) pause();
    else frame = requestAnimationFrame(tick);
  }

  play.addEventListener('click', () => {
    if (playing) return pause();
    if (progress === 1) progress = 0;
    if (reducedMotion.matches) {
      progress = Math.min(1, progress + 0.05);
      draw();
      updateButton();
      updateStatus();
      return;
    }
    playing = true;
    lastTime = performance.now();
    updateButton();
    updateStatus();
    draw();
    frame = requestAnimationFrame(tick);
  });

  timeline.addEventListener('input', () => {
    pause();
    progress = Number(timeline.value);
    draw();
    updateButton();
    updateStatus();
  });

  mode.addEventListener('change', () => {
    draw();
    updateStatus();
  });

  function setTheme() {
    document.documentElement.dataset.theme = theme.value;
    readPalette();
    draw();
  }

  theme.addEventListener('change', setTheme);
  darkTheme.addEventListener('change', setTheme);
  reducedMotion.addEventListener('change', () => {
    if (playing) pause();
    updateButton();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && playing) pause();
  });

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  document.getElementById('exportPng').addEventListener('click', () => {
    const image = document.createElement('canvas');
    image.width = Math.round(width * 2);
    image.height = Math.round(height * 2);
    const imageContext = image.getContext('2d');
    imageContext.scale(2, 2);
    scene.draw(imageContext, width, height, progress, palette, mode.value === 'continuous');
    image.toBlob(blob => {
      if (!blob) { status.textContent = 'Не удалось сохранить PNG.'; return; }
      download(blob, 'dan1l0s-fourier.png');
      status.textContent = 'Текущий кадр сохранён в PNG.';
    }, 'image/png');
  });

  document.getElementById('exportSvg').addEventListener('click', () => {
    const svg = renderSvg(scene, {
      width, height, progress, palette,
      showTransfers: mode.value === 'continuous'
    });
    download(new Blob([svg], {type: 'image/svg+xml'}), 'dan1l0s-fourier.svg');
    status.textContent = 'Текущий кадр сохранён в SVG.';
  });

  readPalette();
  resize();
  new ResizeObserver(resize).observe(document.getElementById('canvasStage'));
  updateStatus();
  if (reducedMotion.matches) updateButton();
}
