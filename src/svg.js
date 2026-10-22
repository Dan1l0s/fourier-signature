const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const number = value => Number(value.toFixed(3));

class SvgContext {
  constructor() {
    this.elements = [];
    this.path = [];
    this.stack = [];
    this.globalAlpha = 1;
    this.lineWidth = 1;
    this.lineCap = 'round';
    this.lineJoin = 'round';
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.dash = [];
  }

  save() {
    const {globalAlpha, lineWidth, lineCap, lineJoin, fillStyle, strokeStyle, dash} = this;
    this.stack.push({globalAlpha, lineWidth, lineCap, lineJoin, fillStyle, strokeStyle, dash});
  }

  restore() { Object.assign(this, this.stack.pop()); }
  setLineDash(dash) { this.dash = [...dash]; }
  beginPath() { this.path = []; }
  moveTo(x, y) { this.path.push(`M${number(x)} ${number(y)}`); }
  lineTo(x, y) { this.path.push(`L${number(x)} ${number(y)}`); }
  closePath() { this.path.push('Z'); }

  arc(x, y, radius, start, end) {
    if (Math.abs(end - start - Math.PI * 2) > 1e-8) {
      throw new Error('Only full circles are used by this renderer.');
    }
    this.moveTo(x + radius, y);
    const r = number(radius);
    this.path.push(`A${r} ${r} 0 1 1 ${number(x - radius)} ${number(y)}`);
    this.path.push(`A${r} ${r} 0 1 1 ${number(x + radius)} ${number(y)}`);
  }

  stroke() {
    if (!this.path.length) return;
    const dash = this.dash.length ? ` stroke-dasharray="${this.dash.join(' ')}"` : '';
    this.elements.push(`<path d="${this.path.join(' ')}" fill="none" stroke="${escape(this.strokeStyle)}" stroke-width="${number(this.lineWidth)}" stroke-linecap="${this.lineCap}" stroke-linejoin="${this.lineJoin}" opacity="${number(this.globalAlpha)}"${dash}/>`);
  }

  fill() {
    if (!this.path.length) return;
    this.elements.push(`<path d="${this.path.join(' ')}" fill="${escape(this.fillStyle)}" opacity="${number(this.globalAlpha)}"/>`);
  }

  fillRect(x, y, width, height) {
    this.elements.push(`<rect x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}" fill="${escape(this.fillStyle)}" opacity="${number(this.globalAlpha)}"/>`);
  }
}

export function renderSvg(scene, {width = 736, height = 380, progress = 1, palette, showTransfers = true}) {
  const context = new SvgContext();
  scene.draw(context, width, height, progress, palette, showTransfers);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
<title id="title">Dan1l0s — Fourier signature</title>
<defs><clipPath id="viewport"><rect width="${width}" height="${height}"/></clipPath></defs>
<g clip-path="url(#viewport)">${context.elements.join('\n')}</g>
</svg>\n`;
}
