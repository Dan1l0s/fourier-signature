const TAU = Math.PI * 2;

function transform(points, inverse) {
  const size = points.length;
  if (!size || !Number.isInteger(Math.log2(size))) {
    throw new RangeError('FFT input length must be a power of two.');
  }
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const point = points[i];
    const tuple = Array.isArray(point) || ArrayBuffer.isView(point);
    real[i] = tuple ? point[0] : point.x;
    imag[i] = tuple ? point[1] : point.y;
    if (!Number.isFinite(real[i]) || !Number.isFinite(imag[i])) {
      throw new TypeError('FFT points must contain two finite coordinates.');
    }
  }

  // Bit reversal puts the input in the order used by the butterfly passes.
  for (let i = 1, reversed = 0; i < size; i++) {
    let bit = size >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (i < reversed) {
      [real[i], real[reversed]] = [real[reversed], real[i]];
      [imag[i], imag[reversed]] = [imag[reversed], imag[i]];
    }
  }

  for (let width = 2; width <= size; width *= 2) {
    const angle = (inverse ? TAU : -TAU) / width;
    const rotationReal = Math.cos(angle);
    const rotationImag = Math.sin(angle);
    const half = width / 2;
    for (let start = 0; start < size; start += width) {
      let cosine = 1;
      let sine = 0;
      for (let offset = 0; offset < half; offset++) {
        const even = start + offset;
        const odd = even + half;
        const oddReal = real[odd] * cosine - imag[odd] * sine;
        const oddImag = real[odd] * sine + imag[odd] * cosine;
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;
        const nextCosine = cosine * rotationReal - sine * rotationImag;
        sine = sine * rotationReal + cosine * rotationImag;
        cosine = nextCosine;
      }
    }
  }
  const scale = inverse ? 1 / size : 1;
  return Array.from({ length: size }, (_, i) => [real[i] * scale, imag[i] * scale]);
}

export function fft(points) {
  return transform(points, false);
}

export function ifft(coefficients) {
  return transform(coefficients, true);
}

export function toHarmonics(points, count = points.length) {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('The harmonic count must be a positive integer.');
  }
  const size = points.length;
  const coefficients = fft(points);
  const harmonics = coefficients.map(([real, imag], index) => [
    index < size / 2 ? index : index - size,
    real / size,
    imag / size
  ]);
  const dc = harmonics.shift();
  harmonics.sort((a, b) =>
    (b[1] ** 2 + b[2] ** 2) - (a[1] ** 2 + a[2] ** 2)
    || Math.abs(a[0]) - Math.abs(b[0]) || a[0] - b[0]
  );
  return [dc, ...harmonics.slice(0, count - 1)];
}

export function evaluateHarmonics(harmonics, phase) {
  if (!Number.isFinite(phase)) throw new TypeError('The phase must be finite.');
  const angle = TAU * (phase % 1);
  let x = 0;
  let y = 0;
  for (const [frequency, real, imag] of harmonics) {
    const cosine = Math.cos(angle * frequency);
    const sine = Math.sin(angle * frequency);
    x += real * cosine - imag * sine;
    y += real * sine + imag * cosine;
  }
  return { x, y };
}
