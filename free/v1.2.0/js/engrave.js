/*
 * Azmeel by Bu Khalil Studio — engraving engine.
 * Copyright (c) 2026 Bu Khalil Studio (Ibrahim Khalil). All rights reserved.
 * Pure geometry: no DOM, no host. Used by the panel preview, SVG export and
 * the Illustrator build, so all three always produce identical shapes.
 *
 * Output space is "points" (W x H of the target artwork). Every size-like
 * parameter is expressed relative to the line spacing, so presets look the
 * same whether the image is 200pt or 2000pt wide.
 *
 * Two source types:
 *  - photo: line width follows image darkness, lines taper out in highlights.
 *  - logo:  the shape is separated from its background, turned into a signed
 *           distance field, and lines are cut exactly at the shape edge.
 *           Width comes from a synthetic shading (flat / bevel / emboss / ...).
 */
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;
  var INF = 1e20;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---------------------------------------------------------------- tone */

  function luminance(px, j) {
    var a = px[j + 3] / 255;
    return ((0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2]) / 255) * a + (1 - a);
  }

  // ImageData -> { data: Float32Array darkness (0 = paper, 1 = ink), width, height }
  function toneMap(img, o) {
    var w = img.width, h = img.height, px = img.data, n = w * h;
    var lum = new Float32Array(n);
    for (var i = 0; i < n; i++) lum[i] = luminance(px, i * 4);
    if (o.blur > 0) boxBlur(lum, w, h, Math.round(o.blur));

    var c = clamp(o.contrast, -0.95, 0.95);
    var cf = (1 + c) / (1 - c);
    var g = 1 / Math.max(0.05, o.gamma);
    for (i = 0; i < n; i++) {
      var v = clamp((lum[i] + o.brightness - 0.5) * cf + 0.5, 0, 1);
      v = Math.pow(v, g);
      lum[i] = o.invert ? v : 1 - v;
    }
    return { data: lum, width: w, height: h };
  }

  function boxBlur(a, w, h, r) {
    if (r < 1) return;
    var tmp = new Float32Array(a.length);
    for (var pass = 0; pass < 2; pass++) {
      blur1D(a, tmp, w, h, r, 1, w);   // horizontal
      blur1D(tmp, a, h, w, r, w, 1);   // vertical
    }
  }

  // Running-sum box blur along one axis. `len` samples per line, `lines` lines,
  // `stride` step between samples, `lineStride` step between line starts.
  function blur1D(s, d, len, lines, r, stride, lineStride) {
    var norm = 1 / (2 * r + 1), last = len - 1;
    for (var ln = 0; ln < lines; ln++) {
      var base = ln * lineStride, acc = 0, k;
      for (k = -r - 1; k < r; k++) acc += s[base + clamp(k, 0, last) * stride];
      for (k = 0; k < len; k++) {
        acc += s[base + Math.min(k + r, last) * stride] - s[base + Math.max(k - r - 1, 0) * stride];
        d[base + k * stride] = acc * norm;
      }
    }
  }

  // Bilinear sampler. Outside the grid: -1 (default) or the nearest edge value (clampEdges).
  function makeSampler(t, clampEdges) {
    var d = t.data, w = t.width, h = t.height;
    return function (u, v) {
      if (u < 0 || v < 0 || u > w - 1 || v > h - 1) {
        if (!clampEdges) return -1;
        u = clamp(u, 0, w - 1); v = clamp(v, 0, h - 1);
      }
      var x0 = u | 0, y0 = v | 0;
      var x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
      var fx = u - x0, fy = v - y0;
      var top = d[y0 * w + x0] + (d[y0 * w + x1] - d[y0 * w + x0]) * fx;
      var bot = d[y1 * w + x0] + (d[y1 * w + x1] - d[y1 * w + x0]) * fx;
      return top + (bot - top) * fy;
    };
  }

  /* ---------------------------------------------------------------- logo */

  // Separate the logo from its background. Uses alpha when the image is
  // transparent, otherwise the colour distance from the dominant border colour.
  function logoMask(img, o) {
    var w = img.width, h = img.height, px = img.data, n = w * h, i, j;
    var mask = new Uint8Array(n), transparent = 0;
    for (i = 0; i < n; i++) if (px[i * 4 + 3] < 128) transparent++;

    if (transparent > n * 0.02) {
      for (i = 0; i < n; i++) mask[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
    } else {
      var bg = borderColor(px, w, h), tol = o.logoTolerance * 441.7;
      for (i = 0, j = 0; i < n; i++, j += 4) {
        var dr = px[j] - bg[0], dg = px[j + 1] - bg[1], db = px[j + 2] - bg[2];
        mask[i] = Math.sqrt(dr * dr + dg * dg + db * db) > tol ? 1 : 0;
      }
    }
    if (o.logoInvert) for (i = 0; i < n; i++) mask[i] = 1 - mask[i];
    // Keep a background frame so every contour is closed.
    for (i = 0; i < w; i++) { mask[i] = 0; mask[n - 1 - i] = 0; }
    for (i = 0; i < h; i++) { mask[i * w] = 0; mask[i * w + w - 1] = 0; }
    return mask;
  }

  function borderColor(px, w, h) {
    // Most common quantised colour along the border.
    var counts = {}, best = null, bestN = 0;
    function add(x, y) {
      var j = (y * w + x) * 4;
      var key = (px[j] >> 4) + ',' + (px[j + 1] >> 4) + ',' + (px[j + 2] >> 4);
      var e = counts[key] || (counts[key] = { n: 0, r: 0, g: 0, b: 0 });
      e.n++; e.r += px[j]; e.g += px[j + 1]; e.b += px[j + 2];
      if (e.n > bestN) { bestN = e.n; best = e; }
    }
    for (var x = 0; x < w; x += 2) { add(x, 0); add(x, h - 1); }
    for (var y = 0; y < h; y += 2) { add(0, y); add(w - 1, y); }
    return [best.r / best.n, best.g / best.n, best.b / best.n];
  }

  function logoField(img, o) {
    return sdfFromMask(logoMask(img, o), img.width, img.height);
  }

  /* ------------------------------------------------------------ portrait */

  // Cut the person out: alpha if the image is transparent, otherwise flood-fill
  // the background from the image border (so similar colours inside the subject
  // survive), drop stray specks, then round off the silhouette.
  function subjectMask(img, o) {
    var w = img.width, h = img.height, px = img.data, n = w * h, i, j;
    var mask = new Uint8Array(n);
    if (!o.removeBg) {
      mask.fill(1);
    } else {
      var transparent = 0;
      for (i = 0; i < n; i++) if (px[i * 4 + 3] < 128) transparent++;
      if (transparent > n * 0.02) {
        for (i = 0; i < n; i++) mask[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
      } else {
        var seen = floodBackground(px, w, h, o.cutTolerance);
        for (i = 0; i < n; i++) mask[i] = seen[i] ? 0 : 1;
        keepMainParts(mask, w, h);
      }
      if (o.silhouetteSmooth > 0) {
        var f = new Float32Array(n);
        for (i = 0; i < n; i++) f[i] = mask[i];
        boxBlur(f, w, h, Math.round(o.silhouetteSmooth));
        for (i = 0; i < n; i++) mask[i] = f[i] >= 0.5 ? 1 : 0;
      }
    }
    for (i = 0; i < w; i++) { mask[i] = 0; mask[n - 1 - i] = 0; }
    for (i = 0; i < h; i++) { mask[i * w] = 0; mask[i * w + w - 1] = 0; }
    return mask;
  }

  // Grow the background inward from the border. A pixel joins when it is close to
  // the border colour (chroma weighted, so skin never matches a grey wall) AND close
  // to the neighbour it is reached from (so soft gradients pass but edges stop it).
  function floodBackground(px, w, h, tolerance) {
    var n = w * h, i, CH = 2.5;
    var Y = new Float32Array(n), U = new Float32Array(n), V = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var j = i * 4, y = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
      Y[i] = y; U[i] = (px[j + 2] - y) * CH; V[i] = (px[j] - y) * CH;
    }
    var r = Math.max(1, Math.round(Math.max(w, h) / 350));
    boxBlur(Y, w, h, r); boxBlur(U, w, h, r); boxBlur(V, w, h, r);

    var ys = [], us = [], vs = [];
    function take(k) { ys.push(Y[k]); us.push(U[k]); vs.push(V[k]); }
    for (i = 0; i < w; i += 2) { take(i); take(n - w + i); }
    for (i = 0; i < h; i += 2) { take(i * w); take(i * w + w - 1); }
    function median(a) { a.sort(function (p, q) { return p - q; }); return a[a.length >> 1]; }
    var bY = median(ys), bU = median(us), bV = median(vs);

    var tolG = tolerance * 321, tolL = tolG * 0.09;
    var seen = new Uint8Array(n), stack = new Int32Array(n), sp = 0;
    function far(k) {
      var a = Y[k] - bY, b = U[k] - bU, c = V[k] - bV;
      return a * a + b * b + c * c > tolG * tolG;
    }
    function seed(k) { if (!seen[k] && !far(k)) { seen[k] = 1; stack[sp++] = k; } }
    function grow(p, q) {
      if (seen[q] || far(q)) return;
      var a = Y[q] - Y[p], b = U[q] - U[p], c = V[q] - V[p];
      if (a * a + b * b + c * c > tolL * tolL) return;
      seen[q] = 1; stack[sp++] = q;
    }
    for (i = 0; i < w; i++) { seed(i); seed(n - 1 - i); }
    for (i = 0; i < h; i++) { seed(i * w); seed(i * w + w - 1); }
    while (sp) {
      var p = stack[--sp], x = p % w;
      if (x > 0) grow(p, p - 1);
      if (x < w - 1) grow(p, p + 1);
      if (p >= w) grow(p, p - w);
      if (p < n - w) grow(p, p + w);
    }
    return seen;
  }

  // Remove connected blobs smaller than 3% of the largest one.
  function keepMainParts(mask, w, h) {
    var n = w * h, label = new Int32Array(n), stack = new Int32Array(n), sizes = [0], i;
    for (i = 0; i < n; i++) {
      if (!mask[i] || label[i]) continue;
      var id = sizes.length, sp = 0, size = 0;
      label[i] = id; stack[sp++] = i;
      while (sp) {
        var k = stack[--sp], x = k % w; size++;
        if (x > 0 && mask[k - 1] && !label[k - 1]) { label[k - 1] = id; stack[sp++] = k - 1; }
        if (x < w - 1 && mask[k + 1] && !label[k + 1]) { label[k + 1] = id; stack[sp++] = k + 1; }
        if (k >= w && mask[k - w] && !label[k - w]) { label[k - w] = id; stack[sp++] = k - w; }
        if (k < n - w && mask[k + w] && !label[k + w]) { label[k + w] = id; stack[sp++] = k + w; }
      }
      sizes.push(size);
    }
    var max = 0;
    for (i = 1; i < sizes.length; i++) if (sizes[i] > max) max = sizes[i];
    for (i = 0; i < n; i++) if (mask[i] && sizes[label[i]] < max * 0.03) mask[i] = 0;
  }

  function subjectField(img, o) {
    return sdfFromMask(subjectMask(img, o), img.width, img.height);
  }

  // Signed distance field in pixels: > 0 inside the mask, < 0 outside.
  function sdfFromMask(mask, w, h) {
    var n = w * h;
    var fIn = new Float64Array(n), fOut = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      fIn[i] = mask[i] ? INF : 0;   // distance to nearest background pixel
      fOut[i] = mask[i] ? 0 : INF;  // distance to nearest logo pixel
    }
    edt2D(fIn, w, h);
    edt2D(fOut, w, h);
    var sdf = new Float32Array(n), area = 0, box = [w, h, 0, 0];
    for (i = 0; i < n; i++) {
      if (mask[i]) {
        sdf[i] = Math.sqrt(fIn[i]) - 0.5; area++;
        var x = i % w, y = (i / w) | 0;
        if (x < box[0]) box[0] = x; if (x > box[2]) box[2] = x;
        if (y < box[1]) box[1] = y; if (y > box[3]) box[3] = y;
      } else sdf[i] = 0.5 - Math.sqrt(fOut[i]);
    }
    return { data: sdf, width: w, height: h, empty: area === 0, box: area ? box : [0, 0, w - 1, h - 1] };
  }

  // Felzenszwalb & Huttenlocher exact squared Euclidean distance transform.
  function edt2D(f, w, h) {
    var m = Math.max(w, h);
    var line = new Float64Array(m), out = new Float64Array(m);
    var v = new Int32Array(m), z = new Float64Array(m + 1);
    var x, y;
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) line[y] = f[y * w + x];
      edt1D(line, h, out, v, z);
      for (y = 0; y < h; y++) f[y * w + x] = out[y];
    }
    for (y = 0; y < h; y++) {
      var row = y * w;
      for (x = 0; x < w; x++) line[x] = f[row + x];
      edt1D(line, w, out, v, z);
      for (x = 0; x < w; x++) f[row + x] = out[x];
    }
  }

  function edt1D(f, n, d, v, z) {
    var k = 0, q, s;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (q = 1; q < n; q++) {
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    for (k = 0, q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  }

  // Closed iso-lines of a field at `level` (marching squares), in grid pixels.
  function contours(field, level) {
    var w = field.width, h = field.height, d = field.data, links = new Map();
    function link(a, b) {
      var la = links.get(a); if (la) la.push(b); else links.set(a, [b]);
      var lb = links.get(b); if (lb) lb.push(a); else links.set(b, [a]);
    }
    for (var y = 0; y < h - 1; y++) {
      for (var x = 0; x < w - 1; x++) {
        var i = y * w + x;
        var c = (d[i] > level ? 8 : 0) | (d[i + 1] > level ? 4 : 0) |
                (d[i + w + 1] > level ? 2 : 0) | (d[i + w] > level ? 1 : 0);
        if (c === 0 || c === 15) continue;
        // Edge ids: 2*i = horizontal edge right of i, 2*i+1 = vertical edge below i.
        var T = 2 * i, B = 2 * (i + w), L = 2 * i + 1, R = 2 * (i + 1) + 1;
        switch (c) {
          case 1: case 14: link(L, B); break;
          case 2: case 13: link(B, R); break;
          case 3: case 12: link(L, R); break;
          case 4: case 11: link(T, R); break;
          case 6: case 9: link(T, B); break;
          case 7: case 8: link(L, T); break;
          case 5: link(L, B); link(T, R); break;
          case 10: link(L, T); link(B, R); break;
        }
      }
    }
    function point(e, out) {
      var idx = e >> 1, a = d[idx], b, t;
      if (e & 1) { b = d[idx + w]; t = (level - a) / (b - a); out.push(idx % w, ((idx / w) | 0) + t); }
      else { b = d[idx + 1]; t = (level - a) / (b - a); out.push(idx % w + t, (idx / w) | 0); }
    }
    var seen = new Set(), loops = [];
    links.forEach(function (_, start) {
      if (seen.has(start)) return;
      var pts = [], prev = -1, cur = start;
      while (cur !== undefined && !seen.has(cur)) {
        seen.add(cur);
        point(cur, pts);
        var nb = links.get(cur), next = nb[0] !== prev ? nb[0] : nb[1];
        prev = cur; cur = next;
      }
      if (pts.length >= 8) loops.push(pts);
    });
    return loops;
  }

  /* -------------------------------------------------------------- guides */
  // A guide is a dense polyline (flat [x,y,x,y...]) the burin follows.

  // `rect` ({x, y, w, h}, optional) limits the guides to part of the image, so a
  // small logo in a large picture doesn't cost lines across all the empty space.
  function guideLines(W, H, spacing, step, angleDeg, wave, rect) {
    rect = rect || { x: 0, y: 0, w: W, h: H };
    var a = angleDeg * Math.PI / 180;
    var dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
    var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    var R = Math.sqrt(rect.w * rect.w + rect.h * rect.h) / 2 + spacing * 2;
    var k = Math.ceil(R / spacing), out = [];
    for (var i = -k; i <= k; i++) {
      var pts = [];
      for (var t = -R; t <= R; t += step) {
        var off = i * spacing;
        if (wave) off += wave.amp * Math.sin(TAU * t / wave.length);
        pts.push(cx + dx * t + nx * off, cy + dy * t + ny * off);
      }
      out.push(pts);
    }
    return out;
  }

  function farthestCorner(W, H, cx, cy, rect) {
    rect = rect || { x: 0, y: 0, w: W, h: H };
    var x0 = rect.x - cx, y0 = rect.y - cy, x1 = x0 + rect.w, y1 = y0 + rect.h;
    return Math.max(Math.hypot(x0, y0), Math.hypot(x1, y0), Math.hypot(x0, y1), Math.hypot(x1, y1));
  }

  function guideCircles(W, H, spacing, step, cx, cy, rect) {
    var Rmax = farthestCorner(W, H, cx, cy, rect), out = [];
    for (var r = spacing * 0.5; r <= Rmax + spacing; r += spacing) {
      var n = Math.max(16, Math.ceil(TAU * r / step)), pts = [];
      for (var j = 0; j <= n; j++) {
        var th = TAU * j / n;
        pts.push(cx + r * Math.cos(th), cy + r * Math.sin(th));
      }
      out.push(pts);
    }
    return out;
  }

  function guideSpiral(W, H, spacing, step, cx, cy, rect) {
    var Rmax = farthestCorner(W, H, cx, cy, rect) + spacing, pts = [], th = 0, r = 0;
    while (r <= Rmax) {
      pts.push(cx + r * Math.cos(th), cy + r * Math.sin(th));
      th += step / Math.max(r, spacing);
      r = spacing * th / TAU;
    }
    return [pts];
  }

  /* ------------------------------------------------------------- ribbons */

  // Ramer–Douglas–Peucker on a flat point array.
  function simplify(pts, tol) {
    var n = pts.length / 2;
    if (n <= 2 || tol <= 0) return pts;
    var keep = new Uint8Array(n), stack = [0, n - 1], t2 = tol * tol, i;
    keep[0] = keep[n - 1] = 1;
    while (stack.length) {
      var e = stack.pop(), s = stack.pop();
      var ax = pts[2 * s], ay = pts[2 * s + 1];
      var dx = pts[2 * e] - ax, dy = pts[2 * e + 1] - ay, L = dx * dx + dy * dy;
      var maxD = -1, idx = -1;
      for (i = s + 1; i < e; i++) {
        var px = pts[2 * i] - ax, py = pts[2 * i + 1] - ay, dd;
        if (L === 0) dd = px * px + py * py;
        else { var cr = px * dy - py * dx; dd = cr * cr / L; }
        if (dd > maxD) { maxD = dd; idx = i; }
      }
      if (maxD > t2) { keep[idx] = 1; stack.push(s, idx, idx, e); }
    }
    var out = [];
    for (i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
    return out;
  }

  /* ---------------------------------------------------------------- noise */

  // Deterministic hash → [0,1). Same inputs always give the same value, so grain and
  // rough edges don't flicker while sliders move.
  // Global seed for every pseudo-random choice; 0 reproduces the original patterns exactly.
  var SEED = 0;

  function hash3(i, j, k) {
    var h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(k | 0, 1274126177) ^ Math.imul(SEED, 668265261);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function vnoise(x, seed) {
    var i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    var a = hash3(i, seed, 11), b = hash3(i + 1, seed, 11);
    return a + (b - a) * u;
  }

  function vnoise2(x, y, seed) {
    var i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    var u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    var a = hash3(i, j, seed), b = hash3(i + 1, j, seed), c = hash3(i, j + 1, seed), d = hash3(i + 1, j + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  // Ink-bleed edges: each side of the stroke wobbles independently (a slow swell plus fine teeth).
  function roughen(S, p, g, i, nx, ny) {
    var t = i * p.step, f1 = 1 / (p.spacing * 1.3), f2 = 1 / (p.spacing * 0.38), s = g * 7 + 3;
    var jt = 1 + p.rough * ((vnoise(t * f1, s) - 0.5) * 1.7 + (vnoise(t * f2, s + 101) - 0.5) * 0.55);
    var jb = 1 + p.rough * ((vnoise(t * f1, s + 53) - 0.5) * 1.7 + (vnoise(t * f2, s + 157) - 0.5) * 0.55);
    jt = Math.max(0, jt); jb = Math.max(0, jb);
    S.tx = S.cx + nx * S.ht * jt; S.ty = S.cy + ny * S.ht * jt;
    S.bx = S.cx - nx * S.hb * jb; S.by = S.cy - ny * S.hb * jb;
  }

  /* ---------------------------------------------------------------- dots */

  var DOT_MODES = { dots: true, grid: true, stipple: true, mist: true, stitch: true };

  // Extensions (the Pro edition registers extra modes, field wrappers and post-processing here).
  var EXT = { modes: {}, wraps: [], posts: [] };
  function registerMode(name, fn) { EXT.modes[name] = fn; DOT_MODES[name] = true; }
  function registerWrap(fn) { EXT.wraps.push(fn); }
  function registerPost(fn) { EXT.posts.push(fn); }
  function wrapField(field, ctx) {
    for (var i = 0; i < EXT.wraps.length; i++) field = EXT.wraps[i](field, ctx) || field;
    return field;
  }
  function postProcess(res, ctx) {
    for (var i = 0; i < EXT.posts.length; i++) res = EXT.posts[i](res, ctx) || res;
    return res;
  }

  // Dot effects over any field (photo, logo or portrait clip). Layers carry
  // dots: [x, y, r, ...]; grid layers also carry a tint (0..1 of the ink colour).
  function dotLayers(field, W, H, spacing, o, rect, colorAt, ctx) {
    rect = rect || { x: 0, y: 0, w: W, h: H };
    if (EXT.modes[o.mode]) return EXT.modes[o.mode](field, spacing, o, rect, colorAt, ctx);
    if (o.mode === 'stitch') return stitchLayers(field, spacing, o, rect, colorAt);
    var S = {}, square = o.dotShape === 'square';
    var shapeK = square ? 0.886 : 1;                      // same area as the circle it replaces
    var shape = square ? 'square' : 'circle';
    function sample(x, y) { field.at(x, y, S, true); return S.edge > 0 ? S.d : -1; }
    function fit(r) { return field.crisp ? Math.min(r, S.edge) : r; }

    if (o.mode === 'mist') return mistLayers(field, spacing, o, rect, S, fit, shape, shapeK);

    if (o.mode === 'stipple') {
      // One chance per cell, jittered inside the cell; darker = more likely.
      // Grain radius ~0.7 cell so fully dark areas close up into solid ink.
      var c = spacing, r0 = c * 0.72 * o.thickness, grain = [];
      var i0 = Math.floor(rect.x / c), i1 = Math.ceil((rect.x + rect.w) / c);
      var j0 = Math.floor(rect.y / c), j1 = Math.ceil((rect.y + rect.h) / c);
      for (var j = j0; j < j1; j++) {
        for (var i = i0; i < i1; i++) {
          var gx = (i + hash3(i, j, 1)) * c, gy = (j + hash3(i, j, 2)) * c;
          var s = sample(gx, gy);
          if (s <= o.minThickness || hash3(i, j, 3) >= s) continue;
          var rr = fit(r0 * (0.75 + 0.25 * s));
          if (rr > 0) grain.push(gx, gy, rr * shapeK);
        }
      }
      return [{ name: 'Grain', shape: shape, dots: grain, polys: [] }];
    }

    var a = o.angle * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    var k = Math.ceil((Math.hypot(rect.w, rect.h) / 2 + spacing) / spacing);
    var rmax = spacing * 0.5 * o.thickness;
    var levels = Math.max(2, Math.round(o.toneLevels || 8)), byLevel = [], dots = [];

    for (var b = -k; b <= k; b++) {
      for (var q = -k; q <= k; q++) {
        var px = cx + (q * ux + b * vx) * spacing, py = cy + (q * uy + b * vy) * spacing;
        if (px < rect.x - spacing || py < rect.y - spacing ||
            px > rect.x + rect.w + spacing || py > rect.y + rect.h + spacing) continue;
        var v = sample(px, py);
        if (v <= o.minThickness) continue;
        if (o.mode === 'grid') {
          var lv = Math.round(v * (levels - 1));
          var gr = fit(rmax);
          if (lv <= 0 || gr <= 0) continue;
          (byLevel[lv] || (byLevel[lv] = [])).push(px, py, gr * shapeK);
        } else {
          // Dot area follows the tone; full-ink dots overlap a little (squares a bit more)
          // so dark areas close up without hairline seams.
          var hr = fit(rmax * Math.sqrt(v) * (square ? 1.24 : 1.15));
          if (hr < rmax * 0.08) continue;
          dots.push(px, py, hr * shapeK);
        }
      }
    }

    if (o.mode === 'dots') return [{ name: 'Dots', shape: shape, dots: dots, polys: [] }];
    var out = [];
    for (var l = 1; l < levels; l++) {
      if (!byLevel[l]) continue;
      out.push({ name: 'Dots ' + Math.round(l / (levels - 1) * 100) + '%', shape: shape,
                 tint: l / (levels - 1), dots: byLevel[l], polys: [] });
    }
    return out;
  }

  /* -------------------------------------------------------------- stitch */

  // Adds the colour of the source image at (x, y) pt into out[0..2], alpha flattened onto
  // white. null when there is no image.
  function colorSampler(img, sx, sy) {
    if (!img || !img.data) return null;
    var d = img.data, w = img.width, h = img.height;
    return function (x, y, out) {
      var u = clamp(Math.round(x * sx), 0, w - 1), v = clamp(Math.round(y * sy), 0, h - 1), j = (v * w + u) * 4;
      var a = d[j + 3] / 255;
      out[0] += d[j] * a + 255 * (1 - a); out[1] += d[j + 1] * a + 255 * (1 - a); out[2] += d[j + 2] * a + 255 * (1 - a);
    };
  }

  function toHex(c) {
    return '#' + [0, 1, 2].map(function (i) {
      var v = clamp(Math.round(c[i]), 0, 255);
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('');
  }

  function dist2(cols, i, p) {
    var a = cols[i * 3] - p[0], b = cols[i * 3 + 1] - p[1], c = cols[i * 3 + 2] - p[2];
    return a * a + b * b + c * c;
  }

  // k-means palette of n colours (flat rgb array). Seeded with farthest-point colours, so
  // small accent colours (a blue medallion in a red carpet) keep their own swatch.
  function palette(cols, n, k) {
    var i, j, mean = [0, 0, 0], best = 0, bd = Infinity, near = new Float64Array(n);
    for (i = 0; i < n; i++) for (j = 0; j < 3; j++) mean[j] += cols[i * 3 + j] / n;
    for (i = 0; i < n; i++) { var dm = dist2(cols, i, mean); if (dm < bd) { bd = dm; best = i; } }
    var centers = [[cols[best * 3], cols[best * 3 + 1], cols[best * 3 + 2]]];
    for (i = 0; i < n; i++) near[i] = dist2(cols, i, centers[0]);
    while (centers.length < k) {
      bd = -1;
      for (i = 0; i < n; i++) if (near[i] > bd) { bd = near[i]; best = i; }
      if (bd < 64) break;                                  // fewer distinct colours than asked
      var p = [cols[best * 3], cols[best * 3 + 1], cols[best * 3 + 2]];
      centers.push(p);
      for (i = 0; i < n; i++) near[i] = Math.min(near[i], dist2(cols, i, p));
    }
    var K = centers.length, label = new Int32Array(n);
    for (var it = 0; it < 10; it++) {
      var sum = new Float64Array(K * 3), cnt = new Float64Array(K);
      for (i = 0; i < n; i++) {
        bd = Infinity; best = 0;
        for (j = 0; j < K; j++) { var dd = dist2(cols, i, centers[j]); if (dd < bd) { bd = dd; best = j; } }
        label[i] = best; cnt[best]++;
        sum[best * 3] += cols[i * 3]; sum[best * 3 + 1] += cols[i * 3 + 1]; sum[best * 3 + 2] += cols[i * 3 + 2];
      }
      for (j = 0; j < K; j++) if (cnt[j]) centers[j] = [sum[j * 3] / cnt[j], sum[j * 3 + 1] / cnt[j], sum[j * 3 + 2] / cnt[j]];
    }
    return { centers: centers, label: label };
  }

  // Outline of a set of grid cells as closed rectilinear loops (corners, in cell units).
  // Each filled cell adds the sides that face an empty cell, all turning the same way, so
  // following the edges always closes a loop; holes come out as loops of their own.
  function traceCells(mask, cols, rows) {
    var W1 = cols + 1, next = new Map(), loops = [];
    function add(a, b) { var l = next.get(a); if (l) l.push(b); else next.set(a, [b]); }
    function on(i, j) { return i >= 0 && j >= 0 && i < cols && j < rows && mask[j * cols + i] === 1; }
    for (var j = 0; j < rows; j++) {
      for (var i = 0; i < cols; i++) {
        if (!on(i, j)) continue;
        if (!on(i, j - 1)) add(j * W1 + i + 1, j * W1 + i);
        if (!on(i - 1, j)) add(j * W1 + i, (j + 1) * W1 + i);
        if (!on(i, j + 1)) add((j + 1) * W1 + i, (j + 1) * W1 + i + 1);
        if (!on(i + 1, j)) add((j + 1) * W1 + i + 1, j * W1 + i + 1);
      }
    }
    next.forEach(function (list, start) {
      while (list.length) {
        var pts = [], cur = start;
        do {
          pts.push(cur % W1, (cur / W1) | 0);
          cur = next.get(cur).pop();
        } while (cur !== start);
        var out = [], m = pts.length / 2;                  // keep the corners only
        for (var k = 0; k < m; k++) {
          var a = (k + m - 1) % m, c = (k + 1) % m;
          var ax = pts[k * 2] - pts[a * 2], ay = pts[k * 2 + 1] - pts[a * 2 + 1];
          var cx = pts[c * 2] - pts[k * 2], cy = pts[c * 2 + 1] - pts[k * 2 + 1];
          if (ax * cy - ay * cx !== 0) out.push(pts[k * 2], pts[k * 2 + 1]);
        }
        if (out.length >= 8) loops.push(out);
      }
    });
    return loops;
  }

  // Stitch: the picture as a chart of square cells, like cross-stitch, filet crochet or
  // pixel art. Each cell is ink or paper (or one of a few shades, or one of the image's own
  // colours), drawn as merged pixels, dots or cross stitches, with optional chart grid lines.
  function stitchLayers(field, spacing, o, rect, colorAt) {
    var c = spacing, S = {}, i, j, k;
    var cols = Math.max(1, Math.floor(rect.w / c + 1e-6)), rows = Math.max(1, Math.floor(rect.h / c + 1e-6));
    var ox = rect.x + (rect.w - cols * c) / 2, oy = rect.y + (rect.h - rows * c) / 2;
    var n = cols * rows, inside = new Uint8Array(n), tone = new Float32Array(n);
    var scheme = o.stitchColors || 'mono';
    var useColor = scheme === 'image' && !!colorAt;
    var rgb = useColor ? new Float32Array(n * 3) : null, acc = [0, 0, 0], SUB = [0.25, 0.75];
    var R9 = new Float32Array(9), G9 = new Float32Array(9), B9 = new Float32Array(9);
    function med(a) { return Array.prototype.slice.call(a).sort(function (p, q) { return p - q; })[4]; }
    for (j = 0; j < rows; j++) {
      for (i = 0; i < cols; i++) {
        k = j * cols + i;
        var x0 = ox + i * c, y0 = oy + j * c;
        field.at(x0 + c / 2, y0 + c / 2, S, true);
        if (!(S.edge > 0)) continue;
        inside[k] = 1;
        var t = 0;
        for (var a = 0; a < 2; a++) {
          for (var b = 0; b < 2; b++) {
            field.at(x0 + SUB[a] * c, y0 + SUB[b] * c, S, true);
            t += S.edge > 0 ? S.d : 0;
          }
        }
        tone[k] = t / 4;
        if (useColor) {
          // Median of 3x3 samples: a clean colour per cell, not a muddy mix of neighbours.
          for (var q = 0; q < 9; q++) {
            acc[0] = acc[1] = acc[2] = 0;
            colorAt(x0 + ((q % 3) + 0.5) / 3 * c, y0 + (Math.floor(q / 3) + 0.5) / 3 * c, acc);
            R9[q] = acc[0]; G9[q] = acc[1]; B9[q] = acc[2];
          }
          rgb[k * 3] = med(R9); rgb[k * 3 + 1] = med(G9); rgb[k * 3 + 2] = med(B9);
        }
      }
    }

    // One group of cells per ink colour / shade.
    var groups = [];
    function group(props) { props.mask = new Uint8Array(n); props.count = 0; groups.push(props); return props; }
    if (useColor) {
      var idx = [];
      for (k = 0; k < n; k++) if (inside[k]) idx.push(k);
      var cc = new Float32Array(idx.length * 3);
      idx.forEach(function (kk, q) { cc[q * 3] = rgb[kk * 3]; cc[q * 3 + 1] = rgb[kk * 3 + 1]; cc[q * 3 + 2] = rgb[kk * 3 + 2]; });
      var pal = idx.length ? palette(cc, idx.length, Math.max(2, Math.round(o.paletteSize || 8))) : { centers: [], label: [] };
      var lum = pal.centers.map(function (p) { return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]; });
      var lightest = lum.indexOf(Math.max.apply(null, lum));
      var byCenter = [];
      pal.centers.map(function (_, q) { return q; }).sort(function (p, q) { return lum[p] - lum[q]; }).forEach(function (q) {
        if (o.stitchSkipLight && q === lightest) return;
        var hex = toHex(pal.centers[q]);
        byCenter[q] = group({ name: 'Color ' + hex, color: hex });
      });
      idx.forEach(function (kk, q) { var g = byCenter[pal.label[q]]; if (g) { g.mask[kk] = 1; g.count++; } });
    } else if (scheme === 'levels') {
      var levels = Math.max(2, Math.round(o.toneLevels || 4)), byLevel = [];
      for (k = 0; k < n; k++) {
        if (!inside[k]) continue;
        var lv = Math.round(clamp(tone[k], 0, 1) * (levels - 1));
        if (lv <= 0) continue;
        var gl = byLevel[lv] || (byLevel[lv] = group({ name: 'Shade ' + Math.round(lv / (levels - 1) * 100) + '%', tint: lv / (levels - 1) }));
        gl.mask[k] = 1; gl.count++;
      }
      groups.sort(function (p, q) { return p.tint - q.tint; });
    } else {
      var thr = o.stitchThreshold == null ? 0.5 : o.stitchThreshold, gm = group({ name: 'Stitches' });
      for (k = 0; k < n; k++) if (inside[k] && tone[k] > thr) { gm.mask[k] = 1; gm.count++; }
    }

    var shape = o.stitchShape || 'square', fill = o.thickness, layers = [];
    groups.forEach(function (g) {
      if (!g.count) return;
      var L = { name: g.name, polys: [] };
      if (g.color) L.color = g.color;
      if (g.tint != null) L.tint = g.tint;
      if (shape === 'square' && fill >= 0.98) {
        // Touching pixels: one outline per connected area instead of thousands of squares.
        L.evenodd = true;
        L.polys = traceCells(g.mask, cols, rows).map(function (q) {
          for (var m = 0; m < q.length; m += 2) { q[m] = ox + q[m] * c; q[m + 1] = oy + q[m + 1] * c; }
          return q;
        });
      } else if (shape === 'cross') {
        var arm = c * 0.5 * Math.min(fill, 1) * 0.86;
        L.stroke = c * 0.2 * Math.max(0.4, fill); L.open = true;
        for (k = 0; k < n; k++) {
          if (!g.mask[k]) continue;
          var cx = ox + (k % cols + 0.5) * c, cy = oy + (Math.floor(k / cols) + 0.5) * c;
          L.polys.push([cx - arm, cy - arm, cx + arm, cy + arm], [cx - arm, cy + arm, cx + arm, cy - arm]);
        }
      } else {
        var r = c * 0.5 * fill, d = [];
        for (k = 0; k < n; k++) if (g.mask[k]) d.push(ox + (k % cols + 0.5) * c, oy + (Math.floor(k / cols) + 0.5) * c, r);
        L.shape = shape === 'square' ? 'square' : 'circle';
        L.dots = d;
      }
      layers.push(L);
    });

    if (o.gridLines) {
      // Chart grid over the cells; every Nth line heavier, like a printed pattern.
      var major = Math.round(o.gridMajor || 0), minor = [], bold = [];
      var gx1 = ox + cols * c, gy1 = oy + rows * c;
      for (i = 0; i <= cols; i++) (major && i % major === 0 ? bold : minor).push([ox + i * c, oy, ox + i * c, gy1]);
      for (j = 0; j <= rows; j++) (major && j % major === 0 ? bold : minor).push([ox, oy + j * c, gx1, oy + j * c]);
      var gcol = o.gridColor || '#9e9e9e', gw = c * 0.07;
      if (minor.length) layers.push({ name: 'Grid', color: gcol, stroke: gw, open: true, polys: minor });
      if (bold.length) layers.push({ name: 'Grid major', color: gcol, stroke: gw * 2.4, open: true, polys: bold });
    }
    return layers;
  }

  // Mist: soft airbrush grain. Every cell gets as many fine specks as its tone needs,
  // counting the overlap between specks, so greys stay true all the way to black.
  // The deepest tones become one solid shape (far fewer paths), and a few
  // paper-coloured sparkles are scattered through the dark areas.
  function mistLayers(field, spacing, o, rect, S, fit, shape, shapeK) {
    var c = spacing, size = o.thickness, floor = o.minThickness;
    var clump = o.clump == null ? 0.5 : o.clump;
    var solidAt = o.solidLevel == null ? 0.9 : o.solidLevel, hasSolid = solidAt < 1;
    var sparkle = o.sparkle || 0;
    // Uneven spray: the tone is pushed up and down by slow noise, most in the mid-greys.
    function spray(x, y, t) {
      if (!clump || t <= 0 || t >= 1) return t;
      var n = vnoise2(x / (c * 9), y / (c * 9), 5) * 0.6 + vnoise2(x / (c * 2.5), y / (c * 2.5), 9) * 0.4;
      return clamp(t + clump * (n * 2 - 1) * Math.min(t, 1 - t) * 1.2, 0, 1);
    }
    // "Ignore light areas" is a paper floor: lighter tones become clean paper and the
    // rest is stretched back to the full range, so there is no hard cut-off.
    function lift(d) { return floor < 1 ? (d - floor) / (1 - floor) : 0; }
    function tone(x, y) {
      field.at(x, y, S, true);
      return S.edge > 0 ? spray(x, y, lift(S.d)) : -1;
    }

    var i0 = Math.floor(rect.x / c), i1 = Math.ceil((rect.x + rect.w) / c);
    var j0 = Math.floor(rect.y / c), j1 = Math.ceil((rect.y + rect.h) / c);
    var grain = [], spark = [], layers = [];
    for (var j = j0; j < j1; j++) {
      for (var i = i0; i < i1; i++) {
        // Which cells get a speck: a low-discrepancy (R2) threshold with a little jitter
        // spreads specks evenly, so mid-greys read smooth instead of blotchy.
        var r2 = 0.7548776662 * i + 0.5698402910 * j + (hash3(i, j, 3) - 0.5) * 0.3;
        for (var m = 0; m < 4; m++) {
          var gx = (i + hash3(i, j, 10 + m)) * c, gy = (j + hash3(i, j, 20 + m)) * c;
          var t = tone(gx, gy);
          if (t <= 0) break;
          if (hasSolid && t > solidAt + 0.04) continue;            // inside the solid shape
          var q = size * (0.32 + 0.34 * t);                         // speck radius / cell: bigger in the darks
          var lambda = -Math.log(1 - Math.min(t, 0.985)) / (3.2 * q * q);
          var thr = r2 + 0.6180339887 * m;
          if (thr - Math.floor(thr) >= lambda - m) continue;
          var r = fit(c * q * (0.75 + 0.5 * hash3(i, j, 40 + m)));
          if (r > 0) grain.push(gx, gy, r * shapeK);
        }
        if (sparkle > 0) {
          var sx = (i + hash3(i, j, 60)) * c, sy = (j + hash3(i, j, 61)) * c;
          var st = tone(sx, sy);
          if (st > 0.4 && hash3(i, j, 62) < sparkle * 0.14 * smoothstep(0.4, 0.8, st)) {
            var sr = fit(c * size * (0.16 + 0.3 * hash3(i, j, 63)));
            if (sr > 0) spark.push(sx, sy, sr);
          }
        }
      }
    }

    if (hasSolid) {
      // Iso-line of (tone - solid level) on a grid a little finer than the grain;
      // crisp fields (logo, cut-out) also stop exactly at their edge.
      var g = c * 0.75, x0 = rect.x - g, y0 = rect.y - g;
      var gw = Math.ceil(rect.w / g) + 3, gh = Math.ceil(rect.h / g) + 3, grid = new Float32Array(gw * gh);
      for (var yy = 0; yy < gh; yy++) {
        for (var xx = 0; xx < gw; xx++) {
          var k = yy * gw + xx;
          if (xx === 0 || yy === 0 || xx === gw - 1 || yy === gh - 1) { grid[k] = -1; continue; }
          var px = x0 + xx * g, py = y0 + yy * g;
          field.at(px, py, S, true);
          var e = field.crisp ? S.edge / (c * 4) : (S.edge > 0 ? 1 : -1);
          grid[k] = Math.min(spray(px, py, lift(S.d)) - solidAt, e);
        }
      }
      var minArea = 4 * c * c, tol = Math.max(c * o.simplify, c * 0.12);
      var shapes = contours({ data: grid, width: gw, height: gh }, 0).map(function (qq) {
        for (var n = 0; n < qq.length; n += 2) { qq[n] = x0 + qq[n] * g; qq[n + 1] = y0 + qq[n + 1] * g; }
        return qq;
      }).filter(function (qq) { return Math.abs(polygonArea(qq)) >= minArea; })
        .map(function (qq) { return simplify(qq, tol); });
      if (shapes.length) layers.push({ name: 'Solid', evenodd: true, polys: shapes });
    }
    layers.push({ name: 'Grain', shape: shape, dots: grain, polys: [] });
    if (spark.length) layers.push({ name: 'Sparkle', paint: 'bg', shape: 'circle', dots: spark, polys: [] });
    return layers;
  }

  // Evaluate the burin at guide point (x,y) with normal (nx,ny) into S:
  // S.edge > 0 inside the drawable area, S.on when ink is laid, S.tx/ty/bx/by edge points.
  function probe(field, p, shade, x, y, nx, ny, S) {
    field.at(x, y, S, true);
    S.on = false;
    if (S.edge <= 0) return;
    var off = p.relief * (S.d - 0.5);          // lines bend with the tone
    S.cx = x + nx * off; S.cy = y + ny * off;
    if (field.crisp && off !== 0) {
      field.at(S.cx, S.cy, S, false);
      if (S.edge <= 0) return;
    }
    var wdt = p.maxW * shade(S.d);
    if (wdt <= 0 || wdt < p.minW) return;
    var ht = wdt / 2, hb = ht;
    if (field.crisp) {
      // Keep the ribbon inside the shape where the edge runs along the line.
      var gn = S.gx * nx + S.gy * ny;
      if (gn < 0) ht = Math.min(ht, S.edge / -gn);
      else if (gn > 0) hb = Math.min(hb, S.edge / gn);
    }
    S.on = true;
    S.ht = ht; S.hb = hb;
    S.tx = S.cx + nx * ht; S.ty = S.cy + ny * ht;
    S.bx = S.cx - nx * hb; S.by = S.cy - ny * hb;
  }

  // Turn guides into closed filled shapes whose width follows the field.
  // Ink runs fading out get pointed tips; runs cut by a logo edge get flat, exact ends.
  function ribbons(guides, field, p, shade, out) {
    var S = {}, B = {};
    for (var g = 0; g < guides.length; g++) {
      var pts = guides[g], n = pts.length / 2;
      if (n < 2) continue;
      var top = [], bot = [], startTip = null, prevC = null, prevEdge = -1, px = 0, py = 0;

      for (var i = 0; i < n; i++) {
        var x = pts[2 * i], y = pts[2 * i + 1];
        var i0 = i > 0 ? i - 1 : i, i1 = i < n - 1 ? i + 1 : i;
        var tx = pts[2 * i1] - pts[2 * i0], ty = pts[2 * i1 + 1] - pts[2 * i0 + 1];
        var tl = Math.sqrt(tx * tx + ty * ty) || 1;
        var nx = -ty / tl, ny = tx / tl;

        probe(field, p, shade, x, y, nx, ny, S);
        if (p.rough > 0 && S.on) roughen(S, p, g, i, nx, ny);
        var inside = S.edge > 0;
        var crossing = field.crisp && i > 0 && inside !== (prevEdge > 0);

        if (crossing) {
          // Find the exact edge between the previous and current sample.
          var lo = 0, hi = 1;
          for (var it = 0; it < 8; it++) {
            var m = (lo + hi) / 2;
            probe(field, p, shade, px + (x - px) * m, py + (y - py) * m, nx, ny, B);
            if ((B.edge > 0) === inside) hi = m; else lo = m;
          }
          var tIn = inside ? hi : lo;
          probe(field, p, shade, px + (x - px) * tIn, py + (y - py) * tIn, nx, ny, B);
          if (inside) {
            startTip = null;
            if (B.on) { top.push(B.tx, B.ty); bot.push(B.bx, B.by); }
          } else if (top.length) {
            if (B.on) { top.push(B.tx, B.ty); bot.push(B.bx, B.by); }
            emit(out, top, bot, startTip, null, p.tol);
            top = []; bot = [];
          }
        }

        if (S.on) {
          if (!top.length) startTip = crossing ? null : prevC;
          top.push(S.tx, S.ty);
          bot.push(S.bx, S.by);
        } else if (top.length) {
          emit(out, top, bot, startTip, inside ? [S.cx, S.cy] : null, p.tol);
          top = []; bot = [];
        }
        prevC = inside ? [S.cx, S.cy] : null;
        prevEdge = S.edge; px = x; py = y;
      }
      if (top.length) emit(out, top, bot, startTip, null, p.tol);
    }
  }

  function emit(out, top, bot, startTip, endTip, tol) {
    var count = top.length / 2;
    if (count < 2 && !(startTip && endTip)) return;
    var lastT = top.length - 2;
    var s = startTip || [(top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2];
    var e = endTip || [(top[lastT] + bot[lastT]) / 2, (top[lastT + 1] + bot[lastT + 1]) / 2];
    top = simplify(top, tol);
    bot = simplify(bot, tol);
    var poly = [s[0], s[1]].concat(top);
    poly.push(e[0], e[1]);
    for (var i = bot.length - 2; i >= 0; i -= 2) poly.push(bot[i], bot[i + 1]);
    out.push(poly);
  }

  /* -------------------------------------------------------------- fields */

  // Dissolve: the artwork fades into the paper towards one side (or all edges),
  // with a ragged, sprayed boundary. Returns null when off.
  function fadeMask(W, H, o) {
    var dir = o.fadeFrom, amt = o.fade || 0;
    if (!amt || !dir || dir === 'none') return null;
    var L = Math.max(W, H);
    return function (x, y) {
      var u;
      switch (dir) {
        case 'top': u = y / H; break;
        case 'left': u = x / W; break;
        case 'right': u = 1 - x / W; break;
        case 'edges': u = 1 - Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2)) / Math.SQRT2; break;
        default: u = 1 - y / H;
      }
      u += (vnoise2(x / L * 7, y / L * 7, 71) - 0.5) * 0.35 * amt + (vnoise2(x / L * 25, y / L * 25, 73) - 0.5) * 0.12 * amt;
      return smoothstep(0, amt, u);
    };
  }

  function fadeField(field, mask) {
    if (!mask) return field;
    return {
      crisp: field.crisp,
      at: function (x, y, S, withShade) {
        field.at(x, y, S, withShade);
        if (withShade || !field.crisp) S.d *= mask(x, y);
      }
    };
  }

  function photoField(tone, sx, sy) {
    var sample = makeSampler(tone, false);
    return {
      crisp: false,
      at: function (x, y, S) {
        var d = sample(x * sx, y * sy);
        S.edge = d < 0 ? -1 : 1;
        S.d = d < 0 ? 0 : d;
      }
    };
  }

  function logoFieldSampler(sdf, tone, box, sx, sy, spacing, o) {
    var sd = makeSampler(sdf, true), tn = makeSampler(tone, true);
    var k = (sx + sy) / 2;                                   // px per pt
    var inset = spacing * ((o.outline ? o.outlineWidth : 0) + o.edgeGap);
    var bevel = Math.max(box.w, box.h) * o.bevelSize;
    var la = o.lightAngle * Math.PI / 180, Lx = Math.cos(la), Ly = Math.sin(la);
    var halfDiag = Math.hypot(box.w, box.h) / 2;
    var mode = o.logoShading;
    return {
      crisp: true,
      at: function (x, y, S, withShade) {
        var u = x * sx, v = y * sy;
        var dist = sd(u, v) / k;
        var gx = sd(u + 1, v) - sd(u - 1, v), gy = sd(u, v + 1) - sd(u, v - 1);
        var gl = Math.sqrt(gx * gx + gy * gy) || 1;
        S.gx = gx / gl; S.gy = gy / gl;                      // points into the shape
        S.edge = dist - inset;
        if (!withShade) return;
        var t, s;
        switch (mode) {
          case 'colors': s = 0.3 + 0.7 * tn(u, v); break;
          case 'bevel': t = clamp(dist / bevel, 0, 1); s = 1 - 0.75 * t; break;
          case 'emboss':
            t = clamp(dist / bevel, 0, 1);
            s = 0.45 + 0.55 * (S.gx * Lx + S.gy * Ly) * (1 - t);  // edges facing the light get thin lines
            break;
          case 'gradient':
            s = 0.55 + 0.6 * ((x - box.cx) * Lx + (y - box.cy) * Ly) / halfDiag;
            break;
          default: s = 1;
        }
        S.d = clamp(s, 0, 1);
      }
    };
  }

  /* ------------------------------------------------------- portrait logo */

  // Emblem frame: rings plus a clip region (positive inside) for the artwork.
  // withText: reserve a band between the outer ring and the inner ring for brand text
  // (circle frames only). The band's radii are returned for the panel/host to lay text on.
  function makeFrame(W, H, o, withText) {
    if (o.frameShape === 'none') return null;
    var size = Math.min(W, H) * o.frameSize, R = size / 2;
    var cx = W * o.frameX, cy = H * o.frameY;
    var ringW = size * o.ringWeight, thinW = ringW * 0.4, ringGap = ringW * 0.9;
    var round = o.frameShape === 'rounded', corner = R * 0.24;
    var rings = [{ inset: ringW / 2, width: ringW, name: 'Frame' }];
    var inner = ringW, textBand = null;
    if (withText && !round) {
      var band = size * o.textSize * 1.55;       // cap height (~0.7 em) plus breathing room
      inner += ringGap;
      textBand = { outer: R - inner, inner: R - inner - band };
      inner += band;
    }
    if (o.doubleRing) {
      rings.push({ inset: inner + ringGap + thinW / 2, width: thinW, name: 'Frame inner' });
      inner = inner + ringGap + thinW;
    }
    var content = inner + ringGap;          // artwork stops here

    function shapeSDF(x, y, inset) {        // positive inside the shape shrunk by `inset`
      var dx = x - cx, dy = y - cy;
      if (!round) return R - inset - Math.sqrt(dx * dx + dy * dy);
      var a = R - inset, rc = Math.max(corner - inset, 0);
      var qx = Math.abs(dx) - (a - rc), qy = Math.abs(dy) - (a - rc);
      var out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rc;
      return -out;
    }

    function outlinePoints(inset, step) {
      var pts = [], a = R - inset;
      if (!round) {
        var n = Math.max(48, Math.ceil(TAU * a / step));
        for (var i = 0; i <= n; i++) pts.push(cx + a * Math.cos(TAU * i / n), cy + a * Math.sin(TAU * i / n));
        return pts;
      }
      var rc = Math.max(corner - inset, 0.01), e = a - rc;
      var centers = [[e, e], [-e, e], [-e, -e], [e, -e]], raw = [];
      for (var c = 0; c < 4; c++) {
        var m = Math.max(6, Math.ceil((Math.PI / 2) * rc / step));
        for (var j = 0; j <= m; j++) {
          var th = (c + j / m) * Math.PI / 2;
          raw.push(cx + centers[c][0] + rc * Math.cos(th), cy + centers[c][1] + rc * Math.sin(th));
        }
      }
      raw.push(raw[0], raw[1]);
      for (var k = 0; k < raw.length - 2; k += 2) {     // densify straight edges
        var x0 = raw[k], y0 = raw[k + 1], x1 = raw[k + 2], y1 = raw[k + 3];
        var s = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
        for (var q = 0; q < s; q++) pts.push(x0 + (x1 - x0) * q / s, y0 + (y1 - y0) * q / s);
      }
      pts.push(pts[0], pts[1]);
      return pts;
    }

    return {
      size: size, R: R, cx: cx, cy: cy, rings: rings, textBand: textBand,
      inside: function (x, y) { return shapeSDF(x, y, content); },
      outline: outlinePoints
    };
  }

  // A crisp field from a scalar clip function (pt, > 0 = draw) and a shade function.
  function clipField(clip, shadeAt, h) {
    return {
      crisp: true,
      at: function (x, y, S, withShade) {
        var e = clip(x, y);
        var gx = clip(x + h, y) - clip(x - h, y), gy = clip(x, y + h) - clip(x, y - h);
        var gl = Math.sqrt(gx * gx + gy * gy) || 1;
        S.gx = gx / gl; S.gy = gy / gl; S.edge = e;
        if (withShade) S.d = shadeAt(x, y);
      }
    };
  }

  function polygonArea(q) {
    var a = 0, n = q.length;
    for (var i = 0; i < n; i += 2) {
      var j = (i + 2) % n;
      a += q[i] * q[j + 1] - q[j] * q[i + 1];
    }
    return a / 2;
  }

  function generatePortrait(maps, W, H, o, opt) {
    var tone = maps.tone, sub = maps.sdf;
    var sx = (tone.width - 1) / W, sy = (tone.height - 1) / H, k = (sx + sy) / 2;
    var sdS = makeSampler(sub, true), tnS = makeSampler(tone, true);
    var b = sub.box;
    var hasText = !!(String(o.topText || "").trim() || String(o.bottomText || "").trim());
    var frame = makeFrame(W, H, o, hasText);
    var L = frame ? frame.size : Math.sqrt(((b[2] - b[0] + 1) / sx) * ((b[3] - b[1] + 1) / sy));
    var spacing = L / o.lines;
    var step = Math.min(spacing * 0.5, 1 / k);
    var gap = spacing * o.subjectGap;
    var hi = o.highlightLevel, sh = Math.max(o.shadowLevel, hi + 0.02);
    var h = 1 / k;

    var subj = function (x, y) { return sdS(x * sx, y * sy) / k; };
    var imageEdge = function (x, y) { return Math.min(x, W - x, y, H - y); };
    var frameClip = frame ? function (x, y) {
      var f = frame.inside(x, y);
      return o.headOverFrame ? Math.max(f, Math.min(frame.cy - y, imageEdge(x, y))) : f;
    } : imageEdge;
    var clip = function (x, y) { return Math.min(subj(x, y), frameClip(x, y)); };

    // Auto levels on the person only (2nd..98th percentile), so pale and dark photos behave alike.
    var sample = [];
    for (var si = 0; si < sub.data.length; si += 7) if (sub.data[si] > 0) sample.push(tone.data[si]);
    sample.sort(function (a, c) { return a - c; });
    var lo = sample.length ? sample[Math.floor(sample.length * 0.02)] : 0;
    var span = sample.length ? Math.max(0.05, sample[Math.floor(sample.length * 0.98)] - lo) : 1;
    var level = function (t) { return clamp((t - lo) / span, 0, 1); };
    // Near the silhouette the blurred tone is diluted by the removed background;
    // read it from a little further inside instead.
    var band = (o.blur || 0) * 2 + 2;
    var toneAt = function (u, v) {
      var d = sdS(u, v);
      if (d > 0 && d < band) {
        var gx = sdS(u + 1, v) - sdS(u - 1, v), gy = sdS(u, v + 1) - sdS(u, v - 1);
        var gl = Math.sqrt(gx * gx + gy * gy) || 1, push = band - d;
        u += gx / gl * push; v += gy / gl * push;
      }
      return tnS(u, v);
    };
    var toneLevel = function (x, y) { return clamp((level(toneAt(x * sx, y * sy)) - hi) / (sh - hi), 0, 1); };

    var p = { maxW: spacing * o.thickness, minW: spacing * o.minThickness, relief: spacing * o.relief, tol: spacing * o.simplify,
              rough: o.roughness || 0, spacing: spacing, step: step };
    var wave = o.mode === 'waves' ? { amp: spacing * o.waveAmp, length: L / o.waveCount } : null;
    var guides = [], dotted = DOT_MODES[o.mode];
    if (dotted) guides = null;
    else if (o.mode === 'circles') guides = guideCircles(W, H, spacing, step, W * o.centerX, H * o.centerY);
    else if (o.mode === 'spiral') guides = guideSpiral(W, H, spacing, step, W * o.centerX, H * o.centerY);
    else guides = guideLines(W, H, spacing, step, o.angle, wave);

    var layers = [];
    if (o.bgFill) layers.push(backgroundLayer(W, H));
    var fade = fadeMask(W, H, o);
    var ectx = { maps: maps, o: o, W: W, H: H, sx: sx, sy: sy, spacing: spacing, type: 'portrait', clip: clip };
    var field = wrapField(fadeField(clipField(clip, toneLevel, h), fade), ectx);

    // Solid shadows: closed shapes where the (smoothed) tone passes the shadow level.
    if (o.solidShadows) {
      var gw = tone.width, gh = tone.height, grid = new Float32Array(gw * gh);
      for (var gyI = 0; gyI < gh; gyI++) {
        for (var gxI = 0; gxI < gw; gxI++) {
          var idx = gyI * gw + gxI;
          var sdv = sub.data[idx];
          if (sdv <= 0) { grid[idx] = sdv; continue; }
          var tv = sdv < band ? toneAt(gxI, gyI) : tone.data[idx];
          var lv = level(tv);
          if (fade) lv = hi + (lv - hi) * fade(gxI / sx, gyI / sy);
          grid[idx] = Math.min((lv - sh) * 60, clip(gxI / sx, gyI / sy) * k);
        }
      }
      var minArea = Math.pow(spacing * 1.2 * k, 2);
      var shapes = contours({ data: grid, width: gw, height: gh }, 0)
        .filter(function (q) { return Math.abs(polygonArea(q)) >= minArea; })
        .map(function (q) {
          for (var i = 0; i < q.length; i += 2) { q[i] /= sx; q[i + 1] /= sy; }
          return simplify(q, Math.max(p.tol * 0.5, 0.5 / k));
        });
      layers.push({ name: 'Shadows', evenodd: true, polys: shapes });
    }

    if (dotted) {
      Array.prototype.push.apply(layers, dotLayers(field, W, H, spacing, o, null, colorSampler(maps.img, sx, sy), ectx));
    } else {
      var main = [];
      ribbons(guides, field, p, function (d) { return d; }, main);
      layers.push({ name: 'Engraving', polys: main });

      if (o.hatch) {
        var thr = o.hatchThreshold, hatch = [];
        ribbons(guideLines(W, H, spacing, step, o.angle + o.hatchAngle, wave), field, p, function (d) {
          return d <= thr ? 0 : (d - thr) / (1 - thr);
        }, hatch);
        layers.push({ name: 'Crosshatch', polys: hatch });
      }
    }

    // Backdrop behind the person, inside the frame.
    if (o.backdrop !== 'none') {
      var bdClip = function (x, y) {
        return Math.min(frame ? frame.inside(x, y) : imageEdge(x, y), -subj(x, y) - gap);
      };
      var bcx = frame ? frame.cx : W / 2, bcy = frame ? frame.cy : H / 2;
      var bR = frame ? frame.R : Math.hypot(W, H) / 2;
      var back = [], bg, bp;
      if (o.backdrop === 'rays') {
        bg = [];
        for (var r = 0; r < o.rayCount; r++) {
          var th = TAU * (r + 0.5) / o.rayCount, ray = [];
          for (var t = 0; t <= bR * 1.05; t += step) ray.push(bcx + Math.cos(th) * t, bcy + Math.sin(th) * t);
          bg.push(ray);
        }
        bp = { maxW: (TAU * bR / o.rayCount) * o.backdropWeight, minW: 0, relief: 0, tol: p.tol };
        ribbons(bg, clipField(bdClip, function (x, y) { return clamp(Math.hypot(x - bcx, y - bcy) / bR, 0, 1); }, h), bp,
          function (d) { return d; }, back);
      } else {
        bg = guideLines(W, H, spacing * 1.5, step, o.mode === 'lines' ? o.angle : 0, null);
        bp = { maxW: spacing * 1.5 * o.backdropWeight, minW: 0, relief: 0, tol: p.tol };
        ribbons(bg, clipField(bdClip, function () { return 1; }, h), bp, function (d) { return d; }, back);
      }
      layers.push({ name: 'Backdrop', polys: back });
    }

    // Thin line around the person, clipped to the frame.
    if (o.silhouetteLine && o.removeBg) {
      var sw = spacing * o.silhouetteWeight, segs = [];
      contours(sub, (sw / 2) * k).forEach(function (q) {
        var cur = [];
        for (var i = 0; i < q.length; i += 2) {
          var x = q[i] / sx, y = q[i + 1] / sy;
          if (frameClip(x, y) > sw * 1.5) cur.push(x, y);    // not along the frame / image edge
          else if (cur.length) { segs.push(cur); cur = []; }
        }
        if (cur.length) segs.push(cur);
      });
      segs = segs.filter(function (q) { return q.length >= 8; })
                 .map(function (q) { return simplify(q, Math.max(p.tol * 0.5, 0.5 / k)); });
      layers.push({ name: 'Silhouette', stroke: sw, open: true, polys: segs });
    }

    // Frame rings; with "head over frame" they are hidden behind the head.
    if (frame) {
      frame.rings.forEach(function (ring) {
        var pts = frame.outline(ring.inset, step), polys = [], cur = [];
        if (!o.headOverFrame) polys.push(simplify(pts.slice(0, -2), p.tol * 0.3));
        else {
          for (var i = 0; i < pts.length; i += 2) {
            var x = pts[i], y = pts[i + 1];
            var hidden = y < frame.cy && subj(x, y) > -(gap + ring.width / 2);
            if (!hidden) cur.push(x, y);
            else if (cur.length) { if (cur.length >= 4) polys.push(cur); cur = []; }
          }
          if (cur.length >= 4) polys.push(cur);
          polys = polys.filter(function (q) {                // drop slivers between hair strands
            var len = 0;
            for (var i = 2; i < q.length; i += 2) len += Math.hypot(q[i] - q[i - 2], q[i + 1] - q[i - 1]);
            return len > frame.R * 0.12;
          }).map(function (q) { return simplify(q, p.tol * 0.3); });
        }
        layers.push({ name: ring.name, stroke: ring.width, open: !!o.headOverFrame, polys: polys });
      });
    }

    // Brand text band: the panel lays the actual text on these radii (it needs font metrics);
    // the engine only reserves the space and draws the separator dots.
    var textLayout = null;
    if (frame && frame.textBand) {
      var tb = frame.textBand, tsize = frame.size * o.textSize;
      textLayout = { cx: frame.cx, cy: frame.cy, outer: tb.outer, inner: tb.inner, size: tsize };
      if (o.textDots) {
        var rMid = (tb.outer + tb.inner) / 2, rd = tsize * 0.13;
        layers.push({ name: "Text dots", shape: "circle", dots: [frame.cx - rMid, frame.cy, rd, frame.cx + rMid, frame.cy, rd], polys: [] });
      }
    }

    var done = finish(W, H, layers);
    done.text = textLayout;
    return finalize(done, ectx, opt);
  }

  // The geometry stage ends here. opt.noPost keeps the result before post-processing (colour, effects),
  // so the panel can cache the geometry and rerun only the cheap stages when a colour changes.
  function finalize(done, ectx, opt) {
    Object.defineProperty(done, 'ctx', { value: ectx, enumerable: false, writable: true });
    return opt && opt.noPost ? done : postProcess(done, ectx);
  }

  // Post stage on a cached geometry result: layers are copied (never the shared point arrays), the
  // context gets the current settings, and the counts are taken again (effects can add marks).
  function post(geom, o) {
    SEED = o.seed | 0;
    var res = { width: geom.width, height: geom.height, layers: geom.layers.map(function (l) { return Object.assign({}, l); }), stats: geom.stats };
    if (geom.text) res.text = geom.text;
    var ctx = Object.assign({}, geom.ctx, { o: o });
    Object.defineProperty(res, 'ctx', { value: ctx, enumerable: false, writable: true });
    res = postProcess(res, ctx);
    res.stats = countLayers(res.layers);
    return res;
  }

  // A filled rectangle behind everything, painted with the background colour.
  function backgroundLayer(W, H) {
    return { name: 'Background', paint: 'bg', rect: [0, 0, W, H], polys: [] };
  }

  function finish(W, H, layers) {
    return { width: W, height: H, layers: layers, stats: countLayers(layers) };
  }

  function countLayers(layers) {
    var paths = 0, points = 0;
    layers.forEach(function (l) {
      if (l.dots) { paths += l.dots.length / 3; points += l.dots.length / 3 * 4; }
      if (l.glyphs) { paths += l.glyphs.length / 4; points += l.glyphs.length / 4 * 12; }
      if (l.instances) {
        var n = l.instances.length / 4, pp = 0;
        l.proto.polys.forEach(function (q) { pp += q.length / 2; });
        paths += n * (l.asSymbols ? 1 : l.proto.polys.length); points += n * pp;
      }
      if (l.rect) { paths++; points += 4; }
      paths += l.polys.length;
      l.polys.forEach(function (q) { points += q.length / 2; });
    });
    return { paths: paths, points: points };
  }

  /* ------------------------------------------------------------ generate */

  // maps: { tone } for photos, { tone, sdf } for logos and portraits (same pixel grid).
  function generate(maps, W, H, o, opt) {
    SEED = o.seed | 0;
    if (o.type === 'portrait' && maps.sdf) return generatePortrait(maps, W, H, o, opt);
    var grid = maps.tone;
    var sx = (grid.width - 1) / W, sy = (grid.height - 1) / H;
    var logo = o.type === 'logo' && maps.sdf;
    var L = Math.max(W, H), box = null;
    if (logo) {
      // Logos usually sit in empty space: size the pattern to the shape itself.
      var b = maps.sdf.box;
      box = { w: (b[2] - b[0] + 1) / sx, h: (b[3] - b[1] + 1) / sy,
              cx: (b[0] + b[2]) / 2 / sx, cy: (b[1] + b[3]) / 2 / sy };
      L = Math.sqrt(box.w * box.h);
    }
    var spacing = L / o.lines;
    var step = Math.min(spacing * 0.5, Math.max(W, H) / Math.max(grid.width, grid.height));
    var p = {
      maxW: spacing * o.thickness,
      minW: spacing * o.minThickness,
      relief: spacing * o.relief,
      tol: spacing * o.simplify,
      rough: o.roughness || 0,
      spacing: spacing,
      step: step
    };
    var field = logo ? logoFieldSampler(maps.sdf, maps.tone, box, sx, sy, spacing, o)
                     : photoField(maps.tone, sx, sy);
    var wave = o.mode === 'waves' ? { amp: spacing * o.waveAmp, length: L / o.waveCount } : null;
    var rect = null, cx = W * o.centerX, cy = H * o.centerY, guides;
    if (logo) {
      // Lines never leave the logo, so only cover its box (plus a small margin).
      var pad = spacing * 3;
      rect = { x: box.cx - box.w / 2 - pad, y: box.cy - box.h / 2 - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
      cx = box.cx - box.w / 2 + box.w * o.centerX;           // ring / spiral centre relative to the logo
      cy = box.cy - box.h / 2 + box.h * o.centerY;
    }
    // The extension context is built once `rect` is known (it used to be read before it was set).
    var ectx = { maps: maps, o: o, W: W, H: H, sx: sx, sy: sy, spacing: spacing, type: o.type, rect: rect };
    field = wrapField(fadeField(field, fadeMask(W, H, o)), ectx);

    var layers = [];
    if (o.bgFill) layers.push(backgroundLayer(W, H));

    if (DOT_MODES[o.mode]) {
      Array.prototype.push.apply(layers, dotLayers(field, W, H, spacing, o, rect, colorSampler(maps.img, sx, sy), ectx));
    } else {
      if (o.mode === 'circles') guides = guideCircles(W, H, spacing, step, cx, cy, rect);
      else if (o.mode === 'spiral') guides = guideSpiral(W, H, spacing, step, cx, cy, rect);
      else guides = guideLines(W, H, spacing, step, o.angle, wave, rect);
      var main = [];
      ribbons(guides, field, p, function (d) { return d; }, main);
      layers.push({ name: 'Engraving', polys: main });
    }

    if (o.hatch && !DOT_MODES[o.mode]) {
      var thr = o.hatchThreshold, hatch = [];
      var hg = guideLines(W, H, spacing, step, o.angle + o.hatchAngle, wave, rect);
      ribbons(hg, field, p, function (d) {
        return d <= thr ? 0 : (d - thr) / (1 - thr);
      }, hatch);
      layers.push({ name: 'Crosshatch', polys: hatch });
    }

    if (logo && o.outline) {
      var ow = spacing * o.outlineWidth;
      var loops = contours(maps.sdf, (ow / 2) * (sx + sy) / 2).map(function (q) {
        for (var i = 0; i < q.length; i += 2) { q[i] /= sx; q[i + 1] /= sy; }
        return simplify(q, Math.max(p.tol * 0.5, 0.5 / sx));
      });
      layers.push({ name: 'Outline', stroke: ow, polys: loops });
    }

    return finalize(finish(W, H, layers), ectx, opt);
  }

  /* ------------------------------------------------------------- outputs */
  // Layer kinds: polys (filled, or stroked when `stroke` is set; `open`, `evenodd` flags),
  // dots ([x, y, r, ...] with shape circle|square), rect (background).
  // Colour: paint 'bg' uses the background colour; `tint` mixes background → ink.

  function hexToRgb(h) { return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
  function mixHex(a, b, t) {
    var x = hexToRgb(a), y = hexToRgb(b);
    return '#' + [0, 1, 2].map(function (i) {
      var v = Math.round(x[i] + (y[i] - x[i]) * t);
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('');
  }

  // The colour a layer is painted with. bg: background colour, or white when there is none.
  function layerColor(l, ink, bg) {
    if (l.color) return l.color;
    if (l.paint === 'bg') return bg || '#ffffff';
    return l.tint != null ? mixHex(bg || '#ffffff', ink, l.tint) : ink;
  }

  var BLEND_CSS = { multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-burn': 'color-burn', difference: 'difference' };

  // Canvas gradient from a layer gradient: {type: 'linear'|'radial', x1, y1, x2, y2 | cx, cy, r, stops: [[t, hex], ...]}.
  function canvasGradient(ctx, g) {
    var cg = g.type === 'radial' ? ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.r)
                                 : ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2);
    g.stops.forEach(function (st) { cg.addColorStop(clamp(st[0], 0, 1), st[1]); });
    return cg;
  }

  function draw(ctx, result, color, bg) {
    ctx.lineJoin = 'round';
    result.layers.forEach(function (l) {
      ctx.save();
      ctx.lineCap = l.cap || 'butt';
      if (l.opacity != null) ctx.globalAlpha = l.opacity;
      if (l.blend && BLEND_CSS[l.blend]) ctx.globalCompositeOperation = BLEND_CSS[l.blend];
      drawLayer(ctx, l, color, bg);
      ctx.restore();
    });
  }

  // Glyph layers: glyphs = [x, y, size, charIndex, ...], each glyph's ink box centred on (x, y).
  var glyphBox = {};
  function glyphMetrics(ctx, fontCss, ch) {
    var key = fontCss + '|' + ch;
    if (glyphBox[key]) return glyphBox[key];
    ctx.font = '100px ' + fontCss;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    var m = ctx.measureText(ch);
    var l = m.actualBoundingBoxLeft || 0, r = m.actualBoundingBoxRight || m.width, a = m.actualBoundingBoxAscent || 70, d = m.actualBoundingBoxDescent || 0;
    return (glyphBox[key] = { cx: (r - l) / 2, cy: (d - a) / 2 });
  }
  function glyphFont(f) {
    f = f || {};
    var st = String(f.style || '');
    return { pre: (/italic|oblique/i.test(st) ? 'italic ' : '') + (/bold|black|heavy|semibold|extrabold|ultra/i.test(st) ? 'bold ' : ''),
             fam: '"' + String(f.family || 'Arial').replace(/"/g, '') + '", sans-serif' };
  }
  function drawGlyphs(ctx, l) {
    var g = l.glyphs, gf = glyphFont(l.font), last = -1;
    for (var i = 0; i < g.length; i += 4) {
      var ch = l.chars[g[i + 3]], m = glyphMetrics(ctx, gf.pre + gf.fam, ch), sz = g[i + 2];
      if (sz !== last) { ctx.font = gf.pre + sz.toFixed(2) + 'px ' + gf.fam; last = sz; }
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      if (l.grot && l.grot[i / 4]) {
        // Rotated letter (degrees, clockwise on screen) around its ink-box centre.
        ctx.save();
        ctx.translate(g[i], g[i + 1]);
        ctx.rotate(l.grot[i / 4] * Math.PI / 180);
        ctx.fillText(ch, -m.cx * sz / 100, -m.cy * sz / 100);
        ctx.restore();
      } else ctx.fillText(ch, g[i] - m.cx * sz / 100, g[i + 1] - m.cy * sz / 100);
    }
  }

  function drawLayer(ctx, l, color, bg) {
    ctx.fillStyle = ctx.strokeStyle = l.gradient ? canvasGradient(ctx, l.gradient) : layerColor(l, color, bg);
    if (l.glyphs) { drawGlyphs(ctx, l); return; }
    ctx.beginPath();
    if (l.instances) {
      eachInstance(l, function (pts) {
        ctx.moveTo(pts[0], pts[1]);
        for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        ctx.closePath();
      });
      ctx.fill(l.proto.evenodd ? 'evenodd' : 'nonzero');
      return;
    }
    if (l.rect) {
      ctx.rect(l.rect[0], l.rect[1], l.rect[2], l.rect[3]);
      ctx.fill();
      return;
    }
    if (l.dots) {
      var d = l.dots, square = l.shape === 'square';
      for (var j = 0; j < d.length; j += 3) {
        if (square) ctx.rect(d[j] - d[j + 2], d[j + 1] - d[j + 2], d[j + 2] * 2, d[j + 2] * 2);
        else { ctx.moveTo(d[j] + d[j + 2], d[j + 1]); ctx.arc(d[j], d[j + 1], d[j + 2], 0, TAU); }
      }
      ctx.fill();
      return;
    }
    l.polys.forEach(function (q) {
      ctx.moveTo(q[0], q[1]);
      for (var i = 2; i < q.length; i += 2) ctx.lineTo(q[i], q[i + 1]);
      if (!l.open) ctx.closePath();
    });
    if (l.stroke) { ctx.lineWidth = l.stroke; ctx.stroke(); }
    else ctx.fill(l.evenodd ? 'evenodd' : 'nonzero');
  }

  // Particles: instances = [x, y, size, rotation (rad), ...]; proto.polys are closed shapes in a unit box
  // centred on 0,0. Calls fn with each placed polygon (flat [x, y, ...]).
  function eachInstance(l, fn) {
    var d = l.instances, P = l.proto.polys, out = [];
    for (var j = 0; j < d.length; j += 4) {
      var x = d[j], y = d[j + 1], c = Math.cos(d[j + 3]) * d[j + 2], s = Math.sin(d[j + 3]) * d[j + 2];
      for (var k = 0; k < P.length; k++) {
        var q = P[k];
        out.length = q.length;
        for (var i = 0; i < q.length; i += 2) { out[i] = x + c * q[i] - s * q[i + 1]; out[i + 1] = y + s * q[i] + c * q[i + 1]; }
        fn(out, j / 4, k);
      }
    }
  }

  function toSVG(result, color, bg) {
    var f = function (v) { return Math.round(v * 100) / 100; };
    var s = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + f(result.width) + 'pt" height="' +
      f(result.height) + 'pt" viewBox="0 0 ' + f(result.width) + ' ' + f(result.height) + '">'];
    result.layers.forEach(function (l, li) {
      var id = ' id="' + l.name.replace(/[^\w-]+/g, '-') + '"', col = layerColor(l, color, bg);
      if (l.gradient) {
        var g = l.gradient, gid = 'azg' + li;
        var stops = g.stops.map(function (st) { return '<stop offset="' + f(clamp(st[0], 0, 1)) + '" stop-color="' + st[1] + '"/>'; }).join('');
        s.push(g.type === 'radial'
          ? '<defs><radialGradient id="' + gid + '" gradientUnits="userSpaceOnUse" cx="' + f(g.cx) + '" cy="' + f(g.cy) + '" r="' + f(g.r) + '">' + stops + '</radialGradient></defs>'
          : '<defs><linearGradient id="' + gid + '" gradientUnits="userSpaceOnUse" x1="' + f(g.x1) + '" y1="' + f(g.y1) + '" x2="' + f(g.x2) + '" y2="' + f(g.y2) + '">' + stops + '</linearGradient></defs>');
        col = 'url(#' + gid + ')';
      }
      if (l.opacity != null) id += ' opacity="' + f(l.opacity) + '"';
      if (l.blend && BLEND_CSS[l.blend]) id += ' style="mix-blend-mode:' + BLEND_CSS[l.blend] + '"';
      if (l.rect) {
        s.push('<rect' + id + ' x="' + f(l.rect[0]) + '" y="' + f(l.rect[1]) + '" width="' + f(l.rect[2]) +
          '" height="' + f(l.rect[3]) + '" fill="' + col + '"/>');
        return;
      }
      if (l.glyphs) {
        var gf = glyphFont(l.font), esc = function (c) { return c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
        var tx = ['<g' + id + ' fill="' + col + '" font-family="' + esc(String((l.font || {}).family || 'Arial')) + '"' +
          (/bold/.test(gf.pre) ? ' font-weight="bold"' : '') + (/italic/.test(gf.pre) ? ' font-style="italic"' : '') +
          ' text-anchor="middle" dominant-baseline="central">'];
        for (var gi = 0; gi < l.glyphs.length; gi += 4) {
          var rot = l.grot && l.grot[gi / 4] ? ' transform="rotate(' + f(l.grot[gi / 4]) + ' ' + f(l.glyphs[gi]) + ' ' + f(l.glyphs[gi + 1]) + ')"' : '';
          tx.push('<text x="' + f(l.glyphs[gi]) + '" y="' + f(l.glyphs[gi + 1]) + '" font-size="' + f(l.glyphs[gi + 2]) + '"' + rot + '>' + esc(l.chars[l.glyphs[gi + 3]]) + '</text>');
        }
        s.push(tx.join('') + '</g>');
        return;
      }
      if (l.instances) {
        var ip = [];
        eachInstance(l, function (pts) {
          var parts = ['M' + f(pts[0]) + ' ' + f(pts[1])];
          for (var i = 2; i < pts.length; i += 2) parts.push(f(pts[i]) + ' ' + f(pts[i + 1]));
          ip.push(parts.join('L') + 'Z');
        });
        if (ip.length) s.push('<path' + id + ' fill="' + col + '"' + (l.proto.evenodd ? ' fill-rule="evenodd"' : '') + ' d="' + ip.join('') + '"/>');
        return;
      }
      if (l.dots) {
        if (!l.dots.length) return;
        var dd = [], d = l.dots;
        for (var j = 0; j < d.length; j += 3) {
          var x = f(d[j]), y = f(d[j + 1]), r = f(d[j + 2]);
          if (l.shape === 'square') dd.push('M' + f(d[j] - d[j + 2]) + ' ' + f(d[j + 1] - d[j + 2]) + 'h' + f(2 * d[j + 2]) + 'v' + f(2 * d[j + 2]) + 'h' + f(-2 * d[j + 2]) + 'Z');
          else dd.push('M' + f(d[j] - d[j + 2]) + ' ' + y + 'a' + r + ' ' + r + ' 0 1 0 ' + f(2 * d[j + 2]) + ' 0a' + r + ' ' + r + ' 0 1 0 ' + f(-2 * d[j + 2]) + ' 0Z');
        }
        s.push('<path' + id + ' fill="' + col + '" d="' + dd.join('') + '"/>');
        return;
      }
      if (!l.polys.length) return;
      var pd = l.polys.map(function (q) {
        var parts = ['M' + f(q[0]) + ' ' + f(q[1])];
        for (var i = 2; i < q.length; i += 2) parts.push(f(q[i]) + ' ' + f(q[i + 1]));
        return parts.join('L') + (l.open ? '' : 'Z');
      }).join('');
      var paint = l.stroke
        ? 'fill="none" stroke="' + col + '" stroke-width="' + f(l.stroke) + '" stroke-linejoin="round"' + (l.cap ? ' stroke-linecap="' + l.cap + '"' : '')
        : 'fill="' + col + '"' + (l.evenodd ? ' fill-rule="evenodd"' : '');
      s.push('<path' + id + ' ' + paint + ' d="' + pd + '"/>');
    });
    s.push('</svg>');
    return s.join('\n');
  }

  root.Engraver = {
    toneMap: toneMap, logoField: logoField, subjectField: subjectField, generate: generate,
    draw: draw, toSVG: toSVG, simplify: simplify, layerColor: layerColor, DOT_MODES: DOT_MODES, post: post, countLayers: countLayers,
    registerMode: registerMode, registerWrap: registerWrap, registerPost: registerPost,
    // Building blocks for extensions (Pro edition).
    _: {
      clamp: clamp, hash3: hash3, vnoise: vnoise, vnoise2: vnoise2, smoothstep: smoothstep, makeSampler: makeSampler,
      boxBlur: boxBlur, contours: contours, traceCells: traceCells, simplify: simplify, polygonArea: polygonArea,
      fadeMask: fadeMask, palette: palette, toHex: toHex, mixHex: mixHex, hexToRgb: hexToRgb, ribbons: ribbons,
      guideLines: guideLines, guideCircles: guideCircles, guideSpiral: guideSpiral, finish: finish, backgroundLayer: backgroundLayer,
      canvasGradient: canvasGradient, eachInstance: eachInstance, colorSampler: colorSampler, contoursOf: contours, sdfFromMask: sdfFromMask,
      makeFrame: makeFrame, clipField: clipField, photoField: photoField, fadeField: fadeField, ext: EXT,
      seed: function (v) { if (v !== undefined) SEED = v | 0; return SEED; }
    }
  };
})(this);
