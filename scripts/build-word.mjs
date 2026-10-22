import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toHarmonics, ifft } from '../src/fourier.js';

const epsilon = 1e-9;
const squareDistance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const distance = (a, b) => Math.sqrt(squareDistance(a, b));
const clamp = value => Math.max(0, Math.min(1, value));
const modulo = (value, size) => ((value % size) + size) % size;
const rounded = (value, digits) => Number(value.toFixed(digits));

function readContours(input) {
  if (!Array.isArray(input) || !input.length) throw new Error('No outline contours.');
  return input.map((points, index) => {
    if (!Array.isArray(points) || points.length < 3) {
      throw new Error(`Contour ${index} needs at least three points.`);
    }
    const result = points.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) {
        throw new Error(`Contour ${index} contains an invalid point.`);
      }
      return [...point];
    });
    // Each contour is implicitly closed. Do not traverse its final duplicate.
    if (distance(result[0], result.at(-1)) < 1e-8) result.pop();
    if (result.length < 3) throw new Error(`Contour ${index} is degenerate.`);
    return result;
  });
}

function nearestContacts(a, b) {
  let best;
  // For disjoint polygonal curves, the shortest connection has a vertex at
  // one end and a point on a segment at the other. Check both directions.
  for (const reverse of [false, true]) {
    const points = reverse ? b : a;
    const segments = reverse ? a : b;
    let candidate;
    for (let i = 0; i < points.length; i++) {
      for (let j = 0; j < segments.length; j++) {
        const start = segments[j], end = segments[(j + 1) % segments.length];
        const vx = end[0] - start[0], vy = end[1] - start[1];
        const length2 = vx * vx + vy * vy;
        const t = length2 ? clamp(((points[i][0] - start[0]) * vx + (points[i][1] - start[1]) * vy) / length2) : 0;
        const projected = [start[0] + t * vx, start[1] + t * vy];
        const distance2 = squareDistance(points[i], projected);
        if (!candidate || distance2 < candidate.distance2) {
          const here = { u: i, point: points[i] };
          const there = { u: j + t, point: projected };
          candidate = { distance2, a: reverse ? there : here, b: reverse ? here : there };
        }
      }
    }
    // Keep the first solution when two attachments are numerically tied.
    if (!best || candidate.distance2 < best.distance2 - 1e-10) best = candidate;
  }
  return best;
}

function axisIntersections(points, axis, value) {
  const contacts = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < epsilon) {
      if (Math.abs(a[axis] - value) < 1e-8) {
        contacts.push({ u: i, point: a }, { u: (i + 1) % points.length, point: b });
      }
    } else {
      const t = (value - a[axis]) / delta;
      if (t >= -epsilon && t <= 1 + epsilon) {
        const fraction = clamp(t);
        contacts.push({
          u: i + fraction,
          point: [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])]
        });
      }
    }
  }
  return contacts;
}

function alignedContacts(a, b, axisName, value) {
  if (!['x', 'y'].includes(axisName) || !Number.isFinite(value)) {
    throw new Error('An aligned bridge needs axis "x" or "y" and a finite value.');
  }
  const axis = axisName === 'x' ? 0 : 1;
  let best;
  for (const here of axisIntersections(a, axis, value)) {
    for (const there of axisIntersections(b, axis, value)) {
      const distance2 = squareDistance(here.point, there.point);
      if (!best || distance2 < best.distance2) best = { distance2, a: here, b: there };
    }
  }
  if (!best) throw new Error(`The bridge at ${axisName} = ${value} misses a contour.`);
  return best;
}

export function buildRoute(outline) {
  const originals = readContours(outline.contours);
  const descriptions = outline.bridges;
  if (!Array.isArray(descriptions) || descriptions.length !== originals.length - 1) {
    throw new Error('The bridge tree must have one fewer edge than contours.');
  }
  const neighbours = originals.map(() => []);
  const bridges = [];
  const edgeKeys = new Set();

  // The bridge topology lives in outline.json. Recompute contact points while
  // keeping the five constrained bridges horizontal or vertical.
  for (const description of descriptions) {
    const { from, to, axis, value } = description;
    if (![from, to].every(index => Number.isInteger(index) && index >= 0 && index < originals.length) || from === to) {
      throw new Error('A bridge refers to an invalid contour.');
    }
    const key = [from, to].sort((a, b) => a - b).join(':');
    if (edgeKeys.has(key)) throw new Error(`Duplicate bridge ${key}.`);
    edgeKeys.add(key);
    const contact = axis === undefined
      ? nearestContacts(originals[from], originals[to])
      : alignedContacts(originals[from], originals[to], axis, value);
    neighbours[from].push({ child: to, here: contact.a, there: contact.b });
    neighbours[to].push({ child: from, here: contact.b, there: contact.a });
    bridges.push({ a: contact.a.point, b: contact.b.point, loops: [from, to], length: distance(contact.a.point, contact.b.point) });
  }

  const points = [], edgeInk = [], edgeContours = [];
  const visited = new Set();
  function append(point, ink, contour) {
    if (points.length && distance(points.at(-1), point) < epsilon) return;
    if (points.length) {
      edgeInk.push(ink);
      edgeContours.push(contour);
    }
    points.push([...point]);
  }

  function visit(node, parent, start) {
    if (visited.has(node)) throw new Error('The bridge topology contains a cycle.');
    visited.add(node);
    const contour = originals[node], size = contour.length;
    const startU = modulo(start.u, size);
    append(start.point, false, -1);
    const events = [];
    for (let vertex = 0; vertex < size; vertex++) {
      const delta = modulo(vertex - startU, size);
      if (delta > epsilon) events.push({ delta, kind: 0, point: contour[vertex] });
    }
    for (const link of neighbours[node]) {
      if (link.child !== parent) {
        events.push({ delta: modulo(link.here.u - startU, size), kind: 1, point: link.here.point, link });
      }
    }
    events.sort((a, b) => a.delta - b.delta || a.kind - b.kind);
    for (const event of events) {
      append(event.point, true, node);
      if (event.kind === 1) {
        append(event.link.there.point, false, -1);
        visit(event.link.child, node, event.link.there);
        append(event.point, false, -1);
      }
    }
    append(start.point, true, node);
  }

  const root = outline.start?.contour ?? 0;
  if (!Number.isInteger(root) || !originals[root]) throw new Error('Invalid starting contour.');
  const anchor = outline.start?.point ?? originals[root][0];
  if (!Array.isArray(anchor) || anchor.length !== 2 || !anchor.every(Number.isFinite)) {
    throw new Error('Invalid starting point.');
  }
  let first = 0;
  for (let i = 1; i < originals[root].length; i++) {
    if (squareDistance(originals[root][i], anchor) < squareDistance(originals[root][first], anchor)) first = i;
  }
  visit(root, -1, { u: first, point: originals[root][first] });
  if (visited.size !== originals.length) throw new Error('The bridge tree is disconnected.');
  if (distance(points[0], points.at(-1)) > 1e-8) throw new Error('The route did not close.');

  const cumulative = [0];
  const contourLengths = originals.map(() => 0);
  let transferLength = 0;
  for (let i = 0; i < edgeInk.length; i++) {
    const length = distance(points[i], points[i + 1]);
    cumulative.push(cumulative.at(-1) + length);
    if (edgeInk[i]) contourLengths[edgeContours[i]] += length;
    else transferLength += length;
  }
  for (let i = 0; i < originals.length; i++) {
    const contour = originals[i];
    const perimeter = contour.reduce((sum, point, j) => sum + distance(point, contour[(j + 1) % contour.length]), 0);
    if (Math.abs(contourLengths[i] - perimeter) > 1e-7) throw new Error(`Contour ${i} was not traced exactly once.`);
  }
  const expectedTransfer = 2 * bridges.reduce((sum, bridge) => sum + bridge.length, 0);
  if (Math.abs(transferLength - expectedTransfer) > 1e-7) throw new Error('A bridge was not traversed twice.');
  const length = cumulative.at(-1);
  if (!(length > 0)) throw new Error('The route has zero length.');
  return { points, edgeInk, edgeContours, cumulative, length, transferLength, bridges, originals };
}

export function resampleRoute(route, count) {
  if (!Number.isInteger(count) || count < 2) throw new Error('Sample count must be an integer of at least two.');
  const samples = [];
  let edge = 0;
  for (let i = 0; i < count; i++) {
    const position = i / count * route.length;
    while (edge + 1 < route.cumulative.length - 1 && route.cumulative[edge + 1] <= position) edge++;
    const a = route.points[edge], b = route.points[edge + 1];
    const span = route.cumulative[edge + 1] - route.cumulative[edge];
    const offset = position - route.cumulative[edge];
    samples.push([a[0] + (b[0] - a[0]) / span * offset, a[1] + (b[1] - a[1]) / span * offset]);
  }
  return samples;
}

export function buildWord(outline) {
  const sampleCount = outline.sampleCount ?? 16384;
  const harmonicCount = outline.harmonicCount ?? 1024;
  if (!Number.isInteger(sampleCount) || sampleCount < 2 || (sampleCount & (sampleCount - 1)) !== 0) {
    throw new Error('The FFT sample count must be a power of two.');
  }
  if (!Number.isInteger(harmonicCount) || harmonicCount < 1 || harmonicCount > sampleCount) {
    throw new Error('Harmonic count must be between one and the sample count.');
  }
  if (!(outline.width > 0 && outline.height > 0)) throw new Error('The outline needs positive width and height.');

  const route = buildRoute(outline);
  const samples = resampleRoute(route, sampleCount);
  const harmonics = toHarmonics(samples, harmonicCount);
  const intervals = [];
  for (let i = 0; i < route.edgeInk.length; i++) {
    const ink = route.edgeInk[i];
    const start = route.cumulative[i] / route.length;
    const end = route.cumulative[i + 1] / route.length;
    if (intervals.length && intervals.at(-1).ink === ink) intervals.at(-1).end = end;
    else intervals.push({ start, end, ink });
  }

  // Reconstruct the retained terms with the same FFT implementation. ifft()
  // divides by N, so supply raw FFT coefficients rather than normalized ones.
  const spectrum = Array.from({ length: sampleCount }, () => [0, 0]);
  for (const [frequency, real, imaginary] of harmonics) {
    spectrum[modulo(frequency, sampleCount)] = [real * sampleCount, imaginary * sampleCount];
  }
  const approximation = ifft(spectrum);
  let squaredError = 0, largestSquaredError = 0;
  for (let i = 0; i < sampleCount; i++) {
    const error = squareDistance(approximation[i], samples[i]);
    squaredError += error;
    largestSquaredError = Math.max(largestSquaredError, error);
  }

  return {
    name: outline.name, text: outline.text, width: outline.width, height: outline.height,
    harmonics: harmonics.map(([frequency, real, imaginary]) => [frequency, rounded(real, 9), rounded(imaginary, 9)]),
    intervals,
    originals: route.originals,
    bridges: route.bridges,
    metrics: {
      originalContours: route.originals.length,
      connectedComponents: 1,
      bridges: route.bridges.length,
      harmonics: harmonicCount,
      sampleCount,
      routeLength: rounded(route.length, 4),
      transferLength: rounded(route.transferLength, 4),
      rmsError: rounded(Math.sqrt(squaredError / sampleCount), 6),
      maxError: rounded(Math.sqrt(largestSquaredError), 6)
    }
  };
}

async function main() {
  const outline = JSON.parse(await readFile(new URL('../data/outline.json', import.meta.url), 'utf8'));
  const word = buildWord(outline);
  await writeFile(new URL('../data/word.json', import.meta.url), `${JSON.stringify(word)}\n`);
  console.log('Built data/word.json');
  console.log(JSON.stringify(word.metrics, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Could not build the signature: ${error.message}`);
    process.exitCode = 1;
  });
}
