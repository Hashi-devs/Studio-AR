/* Sketch Studio engine: no UI, no dependencies, runs in any modern browser.

   import {cleanSketch, mockup} from './sketch-studio-engine.js';

   // In your admin upload form:
   const art = await cleanSketch(fileInput.files[0]);               // transparent line art (canvas)
   const shown = mockup(art, {layout:'frame', paper:paperImg});     // framed picture (canvas)
   shown.toBlob(b => fetch('/api/artworks', {method:'POST', body:b}), 'image/jpeg', .92);

   paper = a loaded <img>/canvas of your paper texture, or a CSS colour string. */

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const shade = (h, a) => 'rgb(' + hex(h).map(v => Math.max(0, Math.min(255, v + a))).join(',') + ')';

/* Blank-paper brightness per channel (max-pool, blur, upsample), so shadows and uneven light divide out. */
function paperMap(d, w, h, ch) {
  const B = Math.max(8, Math.round(Math.max(w, h) / 90)), gw = Math.ceil(w / B), gh = Math.ceil(h / B);
  let g = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) { const r = ((y / B) | 0) * gw; for (let x = 0; x < w; x++) { const k = r + ((x / B) | 0), v = d[(y * w + x) * 4 + ch]; if (v > g[k]) g[k] = v; } }
  for (let p = 0; p < 2; p++) {
    const n = new Float32Array(g.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, y - 2); j <= Math.min(gh - 1, y + 2); j++) for (let i = Math.max(0, x - 2); i <= Math.min(gw - 1, x + 2); i++) { s += g[j * gw + i]; c++; }
      n[y * gw + x] = s / c;
    }
    g = n;
  }
  const axis = (n, gn) => { const i = new Int32Array(n), f = new Float32Array(n); for (let x = 0; x < n; x++) { const t = Math.min(gn - 1, Math.max(0, (x + .5) / B - .5)), a = Math.min(gn - 1, t | 0); i[x] = a; f[x] = t - a; } return [i, f]; };
  const [xi, xf] = axis(w, gw), [yi, yf] = axis(h, gh), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const r0 = yi[y] * gw, r1 = Math.min(gh - 1, yi[y] + 1) * gw, fy = yf[y];
    for (let x = 0; x < w; x++) { const a = xi[x], b = Math.min(gw - 1, a + 1), fx = xf[x]; o[y * w + x] = (g[r0 + a] * (1 - fx) + g[r0 + b] * fx) * (1 - fy) + (g[r1 + a] * (1 - fx) + g[r1 + b] * fx) * fy; }
  }
  return o;
}

/* source: File, Blob, <img>, or canvas. Returns a canvas of line art with a transparent background.
   cleanup 0-40 removes paper noise; darkness 0-100 makes strokes solid; boost 0-100 lifts faint lines;
   mode 'ink' = one colour, 'color' = keep original colours. */
export async function cleanSketch(source, { maxSize = 2800, cleanup = 8, darkness = 50, boost = 30, mode = 'ink', ink = '#16181d' } = {}) {
  const bmp = await createImageBitmap(source), s = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
  const W = Math.round(bmp.width * s), H = Math.round(bmp.height * s), c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(bmp, 0, 0, W, H); bmp.close && bmp.close();
  const d = x.getImageData(0, 0, W, H).data, norm = new Uint8ClampedArray(W * H * 3);
  for (let ch = 0; ch < 3; ch++) { const bg = paperMap(d, W, H, ch); for (let i = 0, n = W * H; i < n; i++) norm[i * 3 + ch] = Math.min(255, d[i * 4 + ch] / Math.max(bg[i], 1) * 255); }
  const im = x.createImageData(W, H), o = im.data, col = mode === 'color', rgb = hex(ink);
  const lo = cleanup / 100, hi = Math.max(lo + .05, .9 - .65 * darkness / 100), g = 1 - .5 * boost / 100, lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) { let a = (1 - v / 255 - lo) / (hi - lo); a = a < 0 ? 0 : a > 1 ? 1 : a; lut[v] = Math.round(Math.pow(a, g) * 255); }
  for (let i = 0, n = W * H; i < n; i++) {
    const r = norm[i * 3], gg = norm[i * 3 + 1], b = norm[i * 3 + 2], m = col ? Math.min(r, gg, b) : Math.round(.299 * r + .587 * gg + .114 * b), j = i * 4, den = 255 - m;
    if (col) { if (den > 1) { o[j] = (r - m) / den * 255; o[j + 1] = (gg - m) / den * 255; o[j + 2] = (b - m) / den * 255; } }
    else { o[j] = rgb[0]; o[j + 1] = rgb[1]; o[j + 2] = rgb[2]; }
    o[j + 3] = lut[m];
  }
  x.putImageData(im, 0, 0);
  return c;
}

/* art: canvas from cleanSketch. layout 'frame' | 'flat' | 'clear'.
   paper: loaded image/canvas or CSS colour. Returns a new canvas. */
export function mockup(art, { layout = 'frame', paper = '#ffffff', frame = '#1f1c1a', mat = true } = {}) {
  const W = art.width, H = art.height, c = document.createElement('canvas'), x = c.getContext('2d');
  if (layout === 'clear') { c.width = W; c.height = H; x.drawImage(art, 0, 0); return c; }
  const p = Math.round(W * .05), pw = W + 2 * p, ph = H + 2 * p, fr = layout === 'frame';
  const m = fr && mat ? Math.round(pw * .09) : 0, f = fr ? Math.round(pw * .04) : 0, wl = fr ? Math.round(pw * .14) : 0;
  c.width = pw + 2 * (m + f + wl); c.height = ph + 2 * (m + f + wl);
  const X = wl, Y = wl, FW = pw + 2 * (m + f), FH = ph + 2 * (m + f);
  if (fr) {
    const g = x.createRadialGradient(c.width / 2, c.height * .4, 0, c.width / 2, c.height / 2, Math.max(c.width, c.height) * .75);
    g.addColorStop(0, '#e8e9ea'); g.addColorStop(1, '#c4c6c9'); x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    x.save(); x.shadowColor = 'rgba(0,0,0,.38)'; x.shadowBlur = f * 1.8; x.shadowOffsetY = f * .6; x.fillStyle = '#000'; x.fillRect(X, Y, FW, FH); x.restore();
    const P = (a, col) => { x.fillStyle = col; x.beginPath(); a.forEach((q, i) => i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1])); x.fill(); };
    P([[X, Y], [X + FW, Y], [X + FW - f, Y + f], [X + f, Y + f]], shade(frame, 22));
    P([[X, Y], [X + f, Y + f], [X + f, Y + FH - f], [X, Y + FH]], shade(frame, 6));
    P([[X + FW, Y], [X + FW, Y + FH], [X + FW - f, Y + FH - f], [X + FW - f, Y + f]], shade(frame, -12));
    P([[X, Y + FH], [X + f, Y + FH - f], [X + FW - f, Y + FH - f], [X + FW, Y + FH]], shade(frame, -26));
    if (m) { x.fillStyle = '#f8f7f4'; x.fillRect(X + f, Y + f, FW - 2 * f, FH - 2 * f); }
  }
  const px = X + f + m, py = Y + f + m;
  if (typeof paper === 'string') { x.fillStyle = paper; x.fillRect(px, py, pw, ph); }
  else {
    const a = paper.naturalWidth || paper.width, b = paper.naturalHeight || paper.height, r = (pw > ph) !== (a > b), k = Math.max(pw / (r ? b : a), ph / (r ? a : b));
    x.save(); x.beginPath(); x.rect(px, py, pw, ph); x.clip(); x.translate(px + pw / 2, py + ph / 2); if (r) x.rotate(Math.PI / 2);
    x.drawImage(paper, -a * k / 2, -b * k / 2, a * k, b * k); x.restore();
  }
  if (fr) { x.strokeStyle = 'rgba(0,0,0,.28)'; x.lineWidth = Math.max(2, W * .0025); x.strokeRect(px, py, pw, ph); }
  const dark = typeof paper === 'string' && /^#[0-9a-f]{6}$/i.test(paper) && (.299 * hex(paper)[0] + .587 * hex(paper)[1] + .114 * hex(paper)[2]) < 110;
  x.globalCompositeOperation = dark ? 'source-over' : 'multiply'; x.drawImage(art, px + p, py + p); x.globalCompositeOperation = 'source-over';
  return c;
}

export const toBlob = (canvas, type = 'image/png', q = .92) => new Promise(r => canvas.toBlob(r, type, q));
