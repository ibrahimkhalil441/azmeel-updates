/* Azmeel by Bu Khalil Studio — panel UI. Runs inside Illustrator (CEP) or any browser (preview + SVG only).
 * Copyright (c) 2026 Bu Khalil Studio (Ibrahim Khalil). All rights reserved. */
(function () {
  'use strict';

  var E = window.Engraver;
  var CEP = !!window.__adobe_cep__;
  var CEP_FS = !!(window.cep && window.cep.fs);
  var MAC = /Mac/i.test(navigator.platform || '');
  // Pro edition: js/pro.js (shipped only in Azmeel Pro) defines window.AzmeelPro before this file runs.
  var PRO = window.AzmeelPro || null;

  // Recent errors, for "Copy diagnostics" in About (helps with reports from machines we can't see).
  var LOG = [];
  function logError(msg) {
    LOG.push(new Date().toISOString().slice(11, 19) + ' ' + String(msg).slice(0, 400));
    if (LOG.length > 30) LOG.shift();
  }
  window.addEventListener('error', function (ev) { logError((ev.message || 'error') + ' @' + (ev.filename || '').split('/').pop() + ':' + ev.lineno); });
  window.addEventListener('unhandledrejection', function (ev) { logError('promise: ' + ((ev.reason && ev.reason.message) || ev.reason)); });
  var WORK_RES = { photo: 900, portrait: 1100, logo: 1600 }; // long side of the analysed image, px
  var VERSION = '1.2.0';                                   // keep in sync with CSXS/manifest.xml (build checks)
  var THUMB_RES = 320;                                       // long side used for style thumbnails

  var byId = function (id) { return document.getElementById(id); };
  var isLogo = function (s) { return s.type === 'logo'; };
  var isPortrait = function (s) { return s.type === 'portrait'; };
  var framed = function (s) { return isPortrait(s) && s.frameShape !== 'none'; };
  var waves = function (s) { return s.mode === 'waves'; };
  var dotted = function (s) { return !!E.DOT_MODES[s.mode]; };
  var stroked = function (s) { return !dotted(s); };
  var lined = function (s) { return s.mode === 'lines' || s.mode === 'waves' || s.mode === 'dots' || s.mode === 'grid'; };
  var radial = function (s) { return s.mode === 'circles' || s.mode === 'spiral'; };
  var misty = function (s) { return s.mode === 'mist'; };
  var stitched = function (s) { return s.mode === 'stitch'; };
  var stitchedWith = function (k, v) { return function (s) { return s.mode === 'stitch' && s[k] === v; }; };
  var fading = function (s) { return s.fadeFrom !== 'none'; };
  var hatched = function (s) { return s.hatch && stroked(s); };
  var byMode = function (map, fallback) { return function (s) { return map[s.mode] || fallback; }; };
  var toned = function (s) { return !isLogo(s) || s.logoShading === 'colors'; };
  var photoOnly = function (s) { return !isLogo(s); };
  var cutout = function (s) { return isPortrait(s) && s.removeBg; };
  var circleFrame = function (s) { return isPortrait(s) && s.frameShape === 'circle'; };
  var hasText = function (s) { return !!(String(s.topText || '').trim() || String(s.bottomText || '').trim()); };
  var withText = function (s) { return circleFrame(s) && hasText(s); };

  function optLabel(p, v) {
    var o = p.options.filter(function (x) { return x[0] === v; })[0];
    return o ? o[2] || o[1] : v;
  }
  function pct(v) { return Math.round(v * 100) + '%'; }

  // Sections carry a summary shown when collapsed. Options: [value, label, short label].
  var PARAMS = [
    { section: 'Cut-out', show: isPortrait, sum: function (s) { return s.removeBg ? 'Background removed' : 'Whole image'; } },
    { id: 'removeBg', type: 'checkbox', label: 'Remove background', value: true, show: isPortrait },
    { id: 'cutTolerance', label: 'Background tolerance', hint: 'Raise if background is left around the person; lower if parts of the person disappear.',
      min: 0.02, max: 0.5, step: 0.01, value: 0.14, fmt: '%', show: cutout },
    { id: 'silhouetteSmooth', label: 'Smooth edges', min: 0, max: 12, step: 1, value: 3, fmt: 'px', show: cutout },
    { id: 'silhouetteLine', type: 'checkbox', label: 'Outline the person', value: true, show: cutout },
    { id: 'silhouetteWeight', label: 'Outline weight', min: 0.1, max: 3, step: 0.05, value: 0.45, fmt: '%',
      show: function (s) { return cutout(s) && s.silhouetteLine; } },
    { id: 'solidShadows', type: 'checkbox', label: 'Solid black shadows', value: true, show: isPortrait },
    { id: 'shadowLevel', label: 'Shadows start at', hint: 'Lower = more solid black.', min: 0.4, max: 1, step: 0.01, value: 0.72, fmt: '%', show: isPortrait },
    { id: 'highlightLevel', label: 'White highlights', hint: 'Higher = more clean white areas on the face.', min: 0, max: 0.7, step: 0.01, value: 0.28, fmt: '%', show: isPortrait },

    { section: 'Badge', show: isPortrait, open: true,
      sum: function (s) { return optLabel(P.frameShape, s.frameShape) + (s.backdrop !== 'none' ? ' · ' + optLabel(P.backdrop, s.backdrop) : ''); } },
    { id: 'frameShape', type: 'seg', label: 'Frame', value: 'circle', show: isPortrait,
      options: [['circle', 'Circle'], ['rounded', 'Rounded square', 'Square'], ['none', 'No frame', 'None']] },
    { id: 'frameSize', label: 'Size', min: 0.3, max: 1.2, step: 0.01, value: 0.92, fmt: '%', show: framed },
    { id: 'frameX', label: 'Position X', min: 0, max: 1, step: 0.01, value: 0.5, fmt: '%', show: framed },
    { id: 'frameY', label: 'Position Y', min: 0, max: 1, step: 0.01, value: 0.55, fmt: '%', show: framed },
    { id: 'ringWeight', label: 'Ring weight', min: 0.004, max: 0.06, step: 0.001, value: 0.02, fmt: '%1', show: framed },
    { id: 'doubleRing', type: 'checkbox', label: 'Double ring', value: true, show: framed },
    { id: 'headOverFrame', type: 'checkbox', label: 'Head breaks out of the frame', value: true, show: framed },
    { id: 'backdrop', type: 'seg', label: 'Behind the person', value: 'none', show: isPortrait,
      options: [['none', 'Empty'], ['rays', 'Sunburst rays', 'Rays'], ['lines', 'Lines']] },
    { id: 'rayCount', label: 'Rays', min: 8, max: 120, step: 1, value: 40,
      show: function (s) { return isPortrait(s) && s.backdrop === 'rays'; } },
    { id: 'backdropWeight', label: 'Backdrop weight', min: 0.05, max: 1, step: 0.01, value: 0.35, fmt: '%',
      show: function (s) { return isPortrait(s) && s.backdrop !== 'none'; } },
    { id: 'subjectGap', label: 'Gap around person', min: 0, max: 5, step: 0.1, value: 1.2, fmt: '%',
      show: function (s) { return isPortrait(s) && (s.backdrop !== 'none' || s.frameShape !== 'none'); } },

    { section: 'Brand text', show: circleFrame, open: true,
      sum: function (s) { return [s.topText, s.bottomText].filter(function (t) { return String(t || '').trim(); }).join(' · ') || 'None'; } },
    { id: 'topText', type: 'text', label: 'Top text', placeholder: 'BRAND NAME', value: '', show: circleFrame,
      hint: 'Runs over the top of the badge. With "Head breaks out of the frame" the head may cover it.' },
    { id: 'bottomText', type: 'text', label: 'Bottom text', placeholder: 'EST. 2026', value: '', show: circleFrame },
    { id: 'fontFamily', type: 'font', label: 'Font', value: 'Arial', show: withText },
    { id: 'fontStyle', type: 'fontStyle', label: 'Style', value: 'Bold', show: withText },
    { id: 'textSize', label: 'Text size', min: 0.02, max: 0.12, step: 0.001, value: 0.05, fmt: '%1', show: withText,
      hint: 'Long text shrinks automatically to fit its half of the circle.' },
    { id: 'tracking', label: 'Letter spacing', min: -50, max: 600, step: 10, value: 150, show: withText },
    { id: 'textDots', type: 'checkbox', label: 'Dots between the texts', value: true, show: withText },
    { id: 'textOutline', type: 'checkbox', label: 'Convert text to outlines', value: false, cep: true, show: withText,
      hint: 'Off: the text stays editable in Illustrator.' },

    { section: 'Logo shape', show: isLogo, open: true, sum: function (s) { return optLabel(P.logoShading, s.logoShading); } },
    { id: 'logoShading', type: 'select', label: 'Shading', value: 'emboss', show: isLogo,
      options: [['emboss', 'Emboss (3D light)', 'Emboss'], ['bevel', 'Bevel (heavy edges)', 'Bevel'], ['gradient', 'Gradient'],
                ['flat', 'Flat lines', 'Flat'], ['colors', 'Follow logo colors', 'Logo colors']] },
    { id: 'bevelSize', label: 'Bevel size', min: 0.005, max: 0.15, step: 0.005, value: 0.035, fmt: '%1',
      show: function (s) { return isLogo(s) && (s.logoShading === 'emboss' || s.logoShading === 'bevel'); } },
    { id: 'lightAngle', label: 'Light direction', min: -180, max: 180, step: 5, value: -135, fmt: '°',
      show: function (s) { return isLogo(s) && (s.logoShading === 'emboss' || s.logoShading === 'gradient'); } },
    { id: 'outline', type: 'checkbox', label: 'Outline the logo', value: true, show: isLogo },
    { id: 'outlineWidth', label: 'Outline weight', min: 0.1, max: 3, step: 0.05, value: 0.4, fmt: '%',
      show: function (s) { return isLogo(s) && s.outline; } },
    { id: 'edgeGap', label: 'Gap before edge', min: 0, max: 3, step: 0.05, value: 0.5, fmt: '%', show: isLogo },
    { id: 'logoTolerance', label: 'Background tolerance', hint: 'Raise if part of the logo is missing.', min: 0.02, max: 0.6, step: 0.01, value: 0.12, fmt: '%', show: isLogo },
    { id: 'logoInvert', type: 'checkbox', label: 'Engrave the background instead', value: false, show: isLogo },

    { section: 'Pattern', open: true, sum: function (s) { return optLabel(P.mode, s.mode) + ' · ' + s.lines; } },
    { id: 'mode', type: 'seg', wrap: true, label: 'Pattern', value: 'lines',
      options: [['lines', 'Straight lines', 'Lines'], ['waves', 'Waves'], ['circles', 'Concentric rings', 'Rings'], ['spiral', 'Spiral'],
                ['dots', 'Halftone dots — size follows the tone', 'Halftone'], ['grid', 'Dot grid — even dots, grey follows the tone', 'Dot grid'],
                ['stipple', 'Film grain — random grain, density follows the tone', 'Grain'],
                ['mist', 'Mist — soft airbrush grain with solid blacks', 'Mist'],
                ['stitch', 'Stitch — cross-stitch / pixel chart of square cells', 'Stitch']] },
    { id: 'lines', label: byMode({ dots: 'Dots across', grid: 'Dots across', stipple: 'Grain density', mist: 'Grain density', stitch: 'Cells across' }, 'Line count'),
      hint: 'More = finer detail, more paths.', min: 20, max: 400, step: 1, value: 120 },
    { id: 'thickness', label: byMode({ dots: 'Max dot size', grid: 'Dot size', stipple: 'Grain size', mist: 'Grain size', stitch: 'Cell fill' }, 'Max thickness'),
      hint: 'Size of the mark in the darkest areas.', min: 0.1, max: 1.3, step: 0.01, value: 0.95, fmt: '%' },
    { id: 'minThickness', label: byMode({ dots: 'Smallest dot', grid: 'Hide faint dots', stipple: 'Ignore light areas', mist: 'Ignore light areas' }, 'Min thickness'),
      hint: 'Marks below this are removed — this creates the clean highlights.', min: 0, max: 0.5, step: 0.01, value: 0.06, fmt: '%',
      show: function (s) { return !stitched(s); } },
    { id: 'angle', label: byMode({ dots: 'Grid angle', grid: 'Grid angle' }, 'Angle'), min: -90, max: 90, step: 1, value: 0, fmt: '°', show: lined },
    { id: 'stitchShape', type: 'seg', label: 'Cell shape', value: 'square', show: stitched,
      options: [['square', 'Pixel'], ['circle', 'Dot'], ['cross', 'Cross ×', 'Cross']] },
    { id: 'stitchColors', type: 'seg', label: 'Colors', value: 'mono', show: stitched,
      options: [['mono', 'Ink only', 'Ink'], ['levels', 'Shades of ink', 'Shades'], ['image', 'Image colors', 'Image']] },
    { id: 'stitchThreshold', label: 'Threshold', hint: 'Cells darker than this are stitched.', min: 0.05, max: 0.95, step: 0.01, value: 0.5, fmt: '%',
      show: stitchedWith('stitchColors', 'mono') },
    { id: 'paletteSize', label: 'Number of colors', hint: 'Colors are picked from the image; each one becomes its own group in Illustrator.',
      min: 2, max: 16, step: 1, value: 8, show: stitchedWith('stitchColors', 'image') },
    { id: 'stitchSkipLight', type: 'checkbox', label: 'Leave the lightest color empty', hint: 'Like unstitched fabric.', value: false,
      show: stitchedWith('stitchColors', 'image') },
    { id: 'gridLines', type: 'checkbox', label: 'Chart grid lines', value: false, show: stitched },
    { id: 'gridMajor', label: 'Bold line every', hint: '0 = all lines the same.', min: 0, max: 20, step: 1, value: 10,
      show: function (s) { return stitched(s) && s.gridLines; } },
    { id: 'gridColor', type: 'color', label: 'Grid color', value: '#9e9e9e', show: function (s) { return stitched(s) && s.gridLines; } },
    { id: 'dotShape', type: 'seg', label: 'Dot shape', value: 'circle', show: function (s) { return dotted(s) && !stitched(s); },
      options: [['circle', 'Circle'], ['square', 'Square']] },
    { id: 'solidLevel', label: 'Solid black from', hint: 'Tones darker than this become one solid shape. 100% = grain only.',
      min: 0.5, max: 1, step: 0.01, value: 0.9, fmt: '%', show: misty },
    { id: 'clump', label: 'Spray texture', hint: 'Uneven, airbrush-like clusters in the grain.', min: 0, max: 1, step: 0.01, value: 0.5, fmt: '%', show: misty },
    { id: 'sparkle', label: 'Sparkles', hint: 'Paper-coloured specks scattered through the dark areas.', min: 0, max: 1, step: 0.01, value: 0.35, fmt: '%', show: misty },
    { id: 'toneLevels', label: 'Grey levels', hint: 'How many shades the dot grid uses (one group per shade in Illustrator).',
      min: 2, max: 16, step: 1, value: 8, show: function (s) { return s.mode === 'grid' || (stitched(s) && s.stitchColors === 'levels'); } },
    { id: 'roughness', label: 'Rough edges', hint: 'Ink-bleed edges: each side of the stroke wobbles.', min: 0, max: 1, step: 0.01, value: 0, fmt: '%', show: stroked },
    { id: 'relief', label: 'Relief', hint: 'How much lines bend with the tone — gives the engraved 3D feel.', min: 0, max: 4, step: 0.05, value: 0.9, fmt: '%', show: stroked },
    { id: 'waveAmp', label: 'Wave height', min: 0, max: 6, step: 0.05, value: 1.8, fmt: '%', show: waves },
    { id: 'waveCount', label: 'Waves across', min: 1, max: 40, step: 0.5, value: 7, show: waves },
    { id: 'centerX', label: 'Center X', min: 0, max: 1, step: 0.01, value: 0.5, fmt: '%', show: radial },
    { id: 'centerY', label: 'Center Y', min: 0, max: 1, step: 0.01, value: 0.5, fmt: '%', show: radial },

    { section: 'Dissolve', sum: function (s) { return s.fadeFrom === 'none' ? 'Off' : optLabel(P.fadeFrom, s.fadeFrom) + ' · ' + pct(s.fade); } },
    { id: 'fadeFrom', type: 'select', label: 'Fade into the paper', value: 'none',
      options: [['none', 'Off'], ['bottom', 'From the bottom', 'Bottom'], ['top', 'From the top', 'Top'], ['left', 'From the left', 'Left'],
                ['right', 'From the right', 'Right'], ['edges', 'From all edges', 'Edges']] },
    { id: 'fade', label: 'Fade length', hint: 'How far into the artwork the fade reaches.', min: 0.05, max: 1, step: 0.01, value: 0.5, fmt: '%', show: fading },

    { section: 'Crosshatch', show: stroked, sum: function (s) { return s.hatch ? 'On · ' + s.hatchAngle + '°' : 'Off'; } },
    { id: 'hatch', type: 'checkbox', label: 'Crosshatch dark areas', value: false },
    { id: 'hatchAngle', label: 'Hatch angle', min: 15, max: 90, step: 1, value: 60, fmt: '°', show: hatched },
    { id: 'hatchThreshold', label: 'Starts at darkness', min: 0.1, max: 0.95, step: 0.01, value: 0.55, fmt: '%', show: hatched },

    { section: 'Tone', sum: function (s) { return 'Contrast ' + (s.contrast > 0 ? '+' : '') + pct(s.contrast); } },
    { id: 'brightness', label: 'Brightness', min: -0.5, max: 0.5, step: 0.01, value: 0, fmt: '±%', show: toned },
    { id: 'contrast', label: 'Contrast', min: -0.9, max: 0.9, step: 0.01, value: 0.2, fmt: '±%', show: toned },
    { id: 'gamma', label: 'Gamma', min: 0.3, max: 3, step: 0.01, value: 1, show: toned },
    { id: 'blur', label: 'Smooth image', hint: 'Removes noise and tiny details before engraving.', min: 0, max: 20, step: 1, value: 1, fmt: 'px', show: toned },
    { id: 'invert', type: 'checkbox', label: 'Invert (white lines on dark)', value: false, show: photoOnly },

    { section: 'Output', sum: function (s) { return s.color.toUpperCase() + (s.bgFill ? ' on ' + s.bgColor.toUpperCase() : ''); } },
    { id: 'color', type: 'color', label: 'Ink color', value: '#000000' },
    { id: 'bgFill', type: 'checkbox', label: 'Fill background', hint: 'Adds a filled rectangle behind the artwork — e.g. white dots on black.', value: false },
    { id: 'bgColor', type: 'color', label: 'Background color', value: '#000000', show: function (s) { return s.bgFill; } },
    { id: 'simplify', label: 'Simplify paths', hint: 'Fewer anchor points; too high loses detail.', min: 0, max: 0.3, step: 0.005, value: 0.03, fmt: '%1' },
    { id: 'hideSource', type: 'checkbox', label: 'Hide original after creating', value: true, cep: true }
  ];
  if (PRO && PRO.extendParams) PRO.extendParams(PARAMS, { isLogo: isLogo, isPortrait: isPortrait, dotted: dotted, stroked: stroked,
    lined: lined, byMode: byMode, optLabel: optLabel, pct: pct, E: E });
  var P = {};
  PARAMS.forEach(function (p) { if (p.id) P[p.id] = p; });

  var PRESETS = [
    ['classic', 'photo', 'Classic', { mode: 'lines', lines: 120, thickness: 0.95, minThickness: 0.06, angle: 0, relief: 0.9, contrast: 0.2, blur: 1 }],
    ['banknote', 'photo', 'Banknote', { mode: 'lines', lines: 150, thickness: 0.9, minThickness: 0.05, angle: -35, relief: 0.7, hatch: true, hatchAngle: 70, hatchThreshold: 0.5, contrast: 0.25 }],
    ['fine', 'photo', 'Fine portrait', { mode: 'lines', lines: 210, thickness: 0.9, minThickness: 0.04, angle: 45, relief: 1.4, hatch: true, hatchAngle: 90, hatchThreshold: 0.62, contrast: 0.15 }],
    ['woodcut', 'photo', 'Woodcut', { mode: 'waves', lines: 80, thickness: 0.9, minThickness: 0.04, angle: -15, relief: 0.5, waveAmp: 1.8, waveCount: 7, contrast: 0.2, blur: 2 }],
    ['rings', 'photo', 'Rings', { mode: 'circles', lines: 95, thickness: 0.95, relief: 0.8, centerX: 0.5, centerY: 0.4 }],
    ['spiral', 'photo', 'Spiral', { mode: 'spiral', lines: 100, thickness: 0.95, relief: 0.6, centerY: 0.45 }],
    ['halftone', 'photo', 'Halftone', { mode: 'dots', lines: 60, thickness: 1, minThickness: 0.1, angle: 0, contrast: 0.25, blur: 1, invert: true, color: '#ffffff', bgFill: true, bgColor: '#000000' }],
    ['dotgrid', 'photo', 'Dot grid', { mode: 'grid', lines: 70, thickness: 0.88, minThickness: 0.04, angle: 0, toneLevels: 10, contrast: 0.2, blur: 1, invert: true, color: '#ffffff', bgFill: true, bgColor: '#000000' }],
    ['grain', 'photo', 'Film grain', { mode: 'stipple', lines: 260, thickness: 0.85, minThickness: 0.22, contrast: 0.5, gamma: 1, blur: 1, bgFill: true, bgColor: '#e3ecec', color: '#000000' }],
    ['mist', 'photo', 'Mist', { mode: 'mist', lines: 340, thickness: 1, minThickness: 0.1, contrast: 0.15, gamma: 1, blur: 3, solidLevel: 0.88, clump: 0.35, sparkle: 0.35, fadeFrom: 'bottom', fade: 0.45 }],
    ['stitch-chart', 'photo', 'Stitch chart', { mode: 'stitch', lines: 90, thickness: 1, stitchShape: 'square', stitchColors: 'mono', stitchThreshold: 0.5, contrast: 0.3, blur: 1, color: '#a3161a', gridLines: true, gridMajor: 10, gridColor: '#b3b3b3' }],
    ['stitch-dots', 'photo', 'Dot pixels', { mode: 'stitch', lines: 80, thickness: 0.78, stitchShape: 'circle', stitchColors: 'mono', stitchThreshold: 0.45, contrast: 0.3, blur: 1, color: '#ffffff', bgFill: true, bgColor: '#000000' }],
    ['stitch-color', 'photo', 'Cross-stitch', { mode: 'stitch', lines: 100, thickness: 1, stitchShape: 'square', stitchColors: 'image', paletteSize: 8, contrast: 0.1, blur: 1, gridLines: true, gridMajor: 10, gridColor: '#5c5c5c' }],
    ['ink', 'photo', 'Ink strokes', { mode: 'lines', lines: 44, thickness: 1, minThickness: 0, angle: 90, relief: 0, roughness: 0.35, contrast: 0.3, gamma: 0.75, blur: 2 }],

    ['pl-badge', 'portrait', 'Round badge', { mode: 'lines', lines: 110, thickness: 0.9, minThickness: 0.07, angle: 0, relief: 0.6, contrast: 0.3, blur: 2, frameShape: 'circle', doubleRing: true, headOverFrame: true, backdrop: 'none', shadowLevel: 0.72, highlightLevel: 0.28, simplify: 0.02 }],
    ['pl-rays', 'portrait', 'Sunburst', { mode: 'lines', lines: 110, thickness: 0.9, minThickness: 0.07, angle: 0, relief: 0.6, contrast: 0.3, blur: 2, frameShape: 'circle', doubleRing: true, headOverFrame: true, backdrop: 'rays', rayCount: 36, backdropWeight: 0.45, shadowLevel: 0.72, highlightLevel: 0.28, simplify: 0.02 }],
    ['pl-stamp', 'portrait', 'Stamp', { mode: 'lines', lines: 120, thickness: 0.9, minThickness: 0.07, angle: -45, relief: 0.4, contrast: 0.3, blur: 2, frameShape: 'rounded', doubleRing: true, headOverFrame: false, backdrop: 'lines', backdropWeight: 0.22, frameSize: 0.95, shadowLevel: 0.7, highlightLevel: 0.3, simplify: 0.02 }],
    ['pl-woodcut', 'portrait', 'Woodcut', { mode: 'waves', lines: 80, thickness: 0.95, minThickness: 0.1, angle: 0, relief: 0.4, waveAmp: 1, waveCount: 14, contrast: 0.4, blur: 3, frameShape: 'circle', doubleRing: false, ringWeight: 0.03, headOverFrame: true, backdrop: 'none', shadowLevel: 0.62, highlightLevel: 0.32, simplify: 0.02 }],
    ['pl-glow', 'portrait', 'Glow halftone', { mode: 'dots', lines: 55, thickness: 1, minThickness: 0.08, angle: 0, relief: 0, contrast: 0.2, blur: 2, invert: true, color: '#ffffff', bgFill: true, bgColor: '#000000', frameShape: 'none', backdrop: 'none', solidShadows: false, silhouetteLine: false, shadowLevel: 0.9, highlightLevel: 0.05, simplify: 0.02 }],
    ['pl-halftone', 'portrait', 'Halftone', { mode: 'dots', lines: 70, thickness: 1, minThickness: 0.06, angle: 0, relief: 0, contrast: 0.3, blur: 2, frameShape: 'circle', doubleRing: true, headOverFrame: true, backdrop: 'none', solidShadows: false, silhouetteLine: false, shadowLevel: 0.85, highlightLevel: 0.15, simplify: 0.02 }],
    ['pl-mist', 'portrait', 'Mist', { mode: 'mist', lines: 280, thickness: 1, minThickness: 0.02, relief: 0, contrast: 0.25, blur: 6, frameShape: 'none', backdrop: 'none', solidShadows: false, silhouetteLine: false, shadowLevel: 0.85, highlightLevel: 0.05, solidLevel: 0.9, clump: 0.35, sparkle: 0.35, fadeFrom: 'bottom', fade: 0.5, simplify: 0.02 }],
    ['pl-stitch', 'portrait', 'Stitch', { mode: 'stitch', lines: 80, thickness: 1, stitchShape: 'square', stitchColors: 'mono', stitchThreshold: 0.42, relief: 0, contrast: 0.3, blur: 2, color: '#a3161a', frameShape: 'none', backdrop: 'none', solidShadows: false, silhouetteLine: false, shadowLevel: 0.8, highlightLevel: 0.2, gridLines: true, gridMajor: 10, gridColor: '#b3b3b3', simplify: 0.02 }],
    ['pl-cutout', 'portrait', 'Cut-out', { mode: 'lines', lines: 100, thickness: 0.9, minThickness: 0.07, angle: 0, relief: 0.8, contrast: 0.3, blur: 2, frameShape: 'none', backdrop: 'none', shadowLevel: 0.72, highlightLevel: 0.28, simplify: 0.02 }],

    ['logo-emboss', 'logo', 'Embossed', { mode: 'lines', lines: 90, thickness: 0.95, minThickness: 0.08, angle: 0, relief: 0, logoShading: 'emboss', bevelSize: 0.03, lightAngle: -135, outline: true, outlineWidth: 0.4, edgeGap: 0.5, simplify: 0.02 }],
    ['logo-bevel', 'logo', 'Bevel', { mode: 'lines', lines: 80, thickness: 1, minThickness: 0.1, angle: -45, relief: 0, logoShading: 'bevel', bevelSize: 0.02, outline: false, edgeGap: 0, simplify: 0.02 }],
    ['logo-gradient', 'logo', 'Gradient', { mode: 'lines', lines: 80, thickness: 1, minThickness: 0.06, angle: 0, relief: 0, logoShading: 'gradient', lightAngle: -90, outline: true, outlineWidth: 0.4, edgeGap: 0.5, simplify: 0.02 }],
    ['logo-flat', 'logo', 'Clean lines', { mode: 'lines', lines: 60, thickness: 0.55, minThickness: 0, angle: -45, relief: 0, logoShading: 'flat', outline: true, outlineWidth: 0.45, edgeGap: 0.6, simplify: 0.02 }],
    ['logo-hatch', 'logo', 'Crosshatch', { mode: 'lines', lines: 80, thickness: 0.9, minThickness: 0.08, angle: 30, relief: 0, logoShading: 'emboss', bevelSize: 0.04, lightAngle: -135, hatch: true, hatchAngle: 70, hatchThreshold: 0.6, outline: true, outlineWidth: 0.4, edgeGap: 0.5, simplify: 0.02 }],
    ['logo-waves', 'logo', 'Waves', { mode: 'waves', lines: 70, thickness: 0.9, minThickness: 0.08, angle: 0, relief: 0, waveAmp: 0.9, waveCount: 16, logoShading: 'emboss', bevelSize: 0.03, lightAngle: -135, outline: true, outlineWidth: 0.4, edgeGap: 0.5, simplify: 0.02 }],
    ['logo-dots', 'logo', 'Halftone', { mode: 'dots', lines: 55, thickness: 1, minThickness: 0.05, angle: 45, relief: 0, logoShading: 'emboss', bevelSize: 0.04, lightAngle: -135, outline: true, outlineWidth: 0.35, edgeGap: 0.4, simplify: 0.02 }],
    ['logo-mist', 'logo', 'Mist', { mode: 'mist', lines: 220, thickness: 1, minThickness: 0.02, relief: 0, logoShading: 'gradient', lightAngle: -60, outline: false, edgeGap: 0, solidLevel: 0.82, clump: 0.6, sparkle: 0.3, fadeFrom: 'none', simplify: 0.02 }],
    ['logo-stitch', 'logo', 'Pixel', { mode: 'stitch', lines: 60, thickness: 1, stitchShape: 'square', stitchColors: 'mono', stitchThreshold: 0.3, relief: 0, logoShading: 'flat', outline: false, edgeGap: 0, gridLines: true, gridMajor: 0, gridColor: '#b3b3b3', simplify: 0.02 }],
    ['logo-rings', 'logo', 'Rings', { mode: 'circles', lines: 80, thickness: 0.95, minThickness: 0.08, relief: 0, centerX: 0.5, centerY: 0.5, logoShading: 'emboss', bevelSize: 0.03, lightAngle: -135, outline: true, outlineWidth: 0.4, edgeGap: 0.5, simplify: 0.02 }]
  ];

  // Settings that come from outside the code (My styles, .azmeel files, style packs, artwork recipes) are
  // checked against the parameter table: known keys only, numbers clamped, colours and options validated.
  // Anything else is dropped, so a style file can only ever hold settings, never code.
  var HEX = /^#[0-9a-f]{6}$/i;
  var EXTRA_KEYS = {};                                       // non-parameter keys a module may own: { key: check(v) -> v | undefined }
  function cleanValue(p, v) {
    var t = p.type || 'range';
    if (t === 'range') { v = +v; return isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : undefined; }
    if (t === 'checkbox') return typeof v === 'boolean' ? v : v === 1 || v === 'true' ? true : v === 0 || v === 'false' ? false : undefined;
    if (t === 'seg' || t === 'select') return p.options.some(function (o) { return o[0] === v; }) ? v : undefined;
    if (t === 'color') return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined;
    if (t === 'palette') {
      if (typeof v !== 'string') return undefined;
      var cs = v.split(/[\s,;]+/).filter(function (c) { return HEX.test(c); }).slice(0, p.max || 8);
      return cs.length ? cs.join(',') : undefined;
    }
    if (t === 'curve') return typeof v === 'string' && /^[0-9.,;\- ]{0,400}$/.test(v) ? v : undefined;
    if (t === 'text' || t === 'font' || t === 'fontStyle') return typeof v === 'string' ? v.slice(0, 200) : undefined;
    if (p.clean) return p.clean(v);
    return undefined;
  }
  function sanitizeOpts(o) {
    var out = {};
    if (!o || typeof o !== 'object') return out;
    Object.keys(o).forEach(function (k) {
      var v;
      if (P[k]) v = cleanValue(P[k], o[k]);
      else if (EXTRA_KEYS[k]) v = EXTRA_KEYS[k](o[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }
  function cleanType(t) { return t === 'photo' || t === 'portrait' || t === 'logo' ? t : null; }

  if (PRO && PRO.extendPresets) PRO.extendPresets(PRESETS);
  // User styles come from local storage: check them like any imported file.
  for (var ui0 = PRESETS.length - 1; ui0 >= 0; ui0--) {
    var upr = PRESETS[ui0];
    if (!upr[4] || !upr[4].user) continue;
    if (!cleanType(upr[1])) { PRESETS.splice(ui0, 1); continue; }
    upr[2] = String(upr[2] || 'My style').slice(0, 80);
    upr[3] = sanitizeOpts(upr[3]);
  }

  var TONE_KEYS = ['brightness', 'contrast', 'gamma', 'blur', 'invert'];
  if (PRO && PRO.toneKeys) Array.prototype.push.apply(TONE_KEYS, PRO.toneKeys);
  var MASK_KEYS = ['logoTolerance', 'logoInvert'];
  var SUBJECT_KEYS = ['removeBg', 'cutTolerance', 'silhouetteSmooth'];
  var DEFAULTS = { type: 'photo' };
  PARAMS.forEach(function (p) { if (p.id) DEFAULTS[p.id] = p.value; });

  var state = Object.assign({}, DEFAULTS, PRESETS[0][3]);
  var ui = { preset: PRESETS[0][0], edited: false, compare: false, split: 0.5, thumbJob: 0, toastTimer: 0, userColor: DEFAULTS.color,
            advanced: true, view: { z: 1 } };
  var src = null;      // { img, name, origin, width, height, fromSelection, grids: {res: ImageData} }
  var maps = {}, mapKeys = {}, result = null, timer = 0, busy = false;

  var ICON = {
    linked: '<svg class="i" viewBox="0 0 16 16"><path d="M7 9a2.5 2.5 0 003.5 0l2-2A2.5 2.5 0 009 3.5l-.7.7M9 7a2.5 2.5 0 00-3.5 0l-2 2A2.5 2.5 0 007 12.5l.7-.7"/></svg>',
    embedded: '<svg class="i" viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><path d="M3 11.5l3-3 2.5 2.5L10 9.5l3 3"/></svg>',
    chev: '<svg class="i chev" viewBox="0 0 16 16"><path d="M4.5 6.5L8 10l3.5-3.5"/></svg>'
  };

  /* ------------------------------------------------------------ controls */

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }

  function formatValue(p, v) {
    if (p.fmt === '%') return Math.round(v * 100) + '%';
    if (p.fmt === '%1') return (v * 100).toFixed(1) + '%';
    if (p.fmt === '±%') return (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
    if (p.fmt === '°') return v + '°';
    if (p.fmt === 'px') return v + ' px';
    var dec = String(p.step).split('.')[1];
    return v.toFixed(dec ? dec.length : 0);
  }

  function parseValue(p, text) {
    var n = parseFloat(String(text).replace(',', '.').replace(/[^\d.\-]/g, ''));
    if (!isFinite(n)) return null;
    if (p.fmt === '%' || p.fmt === '%1' || p.fmt === '±%') n /= 100;
    return stepValue(p, n);
  }

  // Clamp to range and snap to the slider step (numerically — never via the rounded label,
  // which made arrow keys stick on params whose step is finer than the display).
  function stepValue(p, n) {
    n = Math.min(p.max, Math.max(p.min, n));
    var dec = (String(p.step).split('.')[1] || '').length;
    return +(Math.round(n / p.step) * p.step).toFixed(dec);
  }

  function sectionOpenState() {
    try { return JSON.parse(localStorage.getItem('engraver.sections') || '{}'); } catch (e) { return {}; }
  }

  function buildControls() {
    var root = byId('controls'), body = null, saved = sectionOpenState();
    PARAMS.forEach(function (p) {
      if (p.section) {
        var sec = el('div', 'section');
        var head = el('button', 'sec-head', ICON.chev + '<span></span><span class="sum"></span>');
        head.children[1].textContent = p.section;
        body = el('div', 'sec-body');
        sec.appendChild(head); sec.appendChild(body); root.appendChild(sec);
        var open = p.section in saved ? saved[p.section] : !!p.open;
        sec.classList.toggle('open', open);
        head.addEventListener('click', function () {
          var o = sec.classList.toggle('open');
          var st = sectionOpenState(); st[p.section] = o;
          try { localStorage.setItem('engraver.sections', JSON.stringify(st)); } catch (e) {}
        });
        p.el = sec; p.sumEl = head.children[2];
        return;
      }
      if (p.cep && !CEP) return;

      var type = p.type || 'range';
      var row = el('div', 'row row-' + type), input;
      if (PRO && PRO.controls && PRO.controls[type]) {
        var made = PRO.controls[type](p, row, PRO.api);
        p.input = made.input; p.row = row; p.customSync = made.sync;
        if (made.nameEl) p.nameEl = made.nameEl;
        body.appendChild(row);
        return;
      }
      var name = el('span', 'name');
      name.textContent = typeof p.label === 'function' ? p.label(state) : p.label;
      if (p.hint) name.title = p.hint;
      p.nameEl = name;

      if (type === 'seg') {
        input = el('div', p.wrap ? 'seg wrap' : 'seg');
        p.options.forEach(function (o) {
          var b = el('button');
          b.textContent = o[2] || o[1];
          b.title = o[1];
          b.dataset.v = o[0];
          b.addEventListener('click', function () { set(p.id, o[0]); });
          input.appendChild(b);
        });
        row.appendChild(name); row.appendChild(input);
      } else if (type === 'text') {
        row = el('div', 'row row-text');
        input = el('input', 'text-input');
        input.type = 'text';
        input.placeholder = p.placeholder || '';
        input.spellcheck = false;
        input.addEventListener('input', function () { set(p.id, input.value); });
        row.appendChild(name); row.appendChild(input);
      } else if (type === 'font') {
        row = el('div', 'row row-text');
        input = el('button', 'font-btn');
        input.innerHTML = '<span class="font-btn-name"></span><span class="font-tag" hidden></span>' + ICON.chev;
        input.addEventListener('click', function (ev) { ev.stopPropagation(); toggleFontMenu(input); });
        row.appendChild(name); row.appendChild(input);
      } else if (type === 'fontStyle') {
        p.dd = makeDropdown(function (v) { set(p.id, v); });
        input = p.dd.el;
        row.appendChild(name); row.appendChild(input);
      } else if (type === 'select') {
        p.dd = makeDropdown(function (v) { set(p.id, v); });
        p.dd.setOptions(p.options.map(function (o) { return [o[0], o[1]]; }));
        input = p.dd.el;
        row.appendChild(name); row.appendChild(input);
      } else if (type === 'checkbox') {
        row = el('label', 'row row-checkbox');
        input = el('input', 'switch'); input.type = 'checkbox';
        input.addEventListener('change', function () { set(p.id, input.checked); });
        row.appendChild(name); row.appendChild(input);
      } else if (type === 'color') {
        p.cp = makeColor(function (v) { set(p.id, v); });
        input = p.cp.el;
        row.appendChild(name); row.appendChild(input);
      } else {
        input = el('input'); input.type = 'range';
        input.min = p.min; input.max = p.max; input.step = p.step;
        var num = el('input', 'num');
        num.title = 'Type a value · double-click the name to reset';
        num.addEventListener('focus', function () { num.select(); });
        num.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') num.blur();
          if (ev.key === 'Escape') { num.value = formatValue(p, state[p.id]); num.blur(); }
          if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
            ev.preventDefault();
            var k = (ev.shiftKey ? 10 : 1) * (ev.key === 'ArrowUp' ? 1 : -1);
            set(p.id, stepValue(p, state[p.id] + k * p.step));
          }
        });
        num.addEventListener('change', function () {
          var v = parseValue(p, num.value);
          if (v === null) num.value = formatValue(p, state[p.id]); else set(p.id, v);
        });
        name.addEventListener('dblclick', function () { set(p.id, DEFAULTS[p.id]); });
        input.addEventListener('input', function () { set(p.id, parseFloat(input.value)); });
        row.appendChild(name); row.appendChild(num); row.appendChild(input);
        p.numEl = num;
      }
      p.input = input; p.row = row;
      body.appendChild(row);
    });
    syncControls();
  }

  function syncParam(p) {
    var v = state[p.id];
    if (p.customSync) { p.customSync(v); return; }
    if (p.type === 'fontStyle') { fillStyleOptions(); return; }
    if (p.type === 'font') { syncFontButton(); return; }
    if (p.type === 'text') {
      if (document.activeElement !== p.input && p.input.value !== v) p.input.value = v;
      return;
    }
    if (p.type === 'checkbox') p.input.checked = !!v;
    else if (p.dd) p.dd.setValue(v);
    else if (p.cp) p.cp.setValue(v);
    else if (p.type === 'seg') {
      Array.prototype.forEach.call(p.input.children, function (b) { b.classList.toggle('on', b.dataset.v === v); });
    } else {
      if (p.input.value !== String(v)) p.input.value = v;
      if (!p.type) p.input.style.setProperty('--p', ((v - p.min) / (p.max - p.min) * 100) + '%');
    }
    if (p.numEl && document.activeElement !== p.numEl) p.numEl.value = formatValue(p, v);
  }

  function syncControls() {
    PARAMS.forEach(function (p) { if (p.input) syncParam(p); });
    syncVisibility();
  }

  function syncVisibility() {
    var section = null, visible = 0;
    function close() {
      if (!section) return;
      section.el.hidden = (section.show && !section.show(state)) || !visible;
      if (section.sum) section.sumEl.textContent = section.sum(state);
    }
    PARAMS.forEach(function (p) {
      if (p.section) { close(); section = p; visible = 0; return; }
      if (!p.row) return;
      p.row.hidden = (p.show ? !p.show(state) : false) || (p.adv && !ui.advanced);
      if (typeof p.label === 'function') p.nameEl.textContent = p.label(state);
      if (!p.row.hidden) visible++;
    });
    close();
    document.querySelectorAll('#typeSeg button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.type === state.type);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', b.dataset.type === state.type ? 'true' : 'false');
    });
    byId('empty').querySelectorAll('[data-for]').forEach(function (e) {
      e.hidden = e.dataset.for !== state.type;
    });
    byId('edited').hidden = !ui.edited;
    document.querySelectorAll('#presets .preset').forEach(function (t) {
      t.classList.toggle('on', t.dataset.key === ui.preset);
    });
  }

  // Output settings and brand text survive preset changes, so they don't count as editing the style.
  var KEEP_KEYS = ['hideSource', 'topText', 'bottomText', 'fontFamily', 'fontStyle', 'textSize', 'tracking', 'textDots', 'textOutline'];
  if (PRO && PRO.keepKeys) Array.prototype.push.apply(KEEP_KEYS, PRO.keepKeys);
  var NOT_STYLE = { color: true };
  KEEP_KEYS.forEach(function (k) { NOT_STYLE[k] = true; });

  function set(id, value) {
    if (value === null || value === undefined) return;
    var prev = state[id];
    state[id] = value;
    // A head breaking out of the frame would sit right on top of the top text.
    if (id === 'topText' && String(value).trim() && !String(prev || '').trim() && state.headOverFrame && circleFrame(state)) {
      state.headOverFrame = false;
      // With the head now inside the circle, raise the frame so the top of the head isn't cut off.
      var sub = maps.subject, px = src && src.grids[WORK_RES.portrait];
      if (sub && px && !sub.empty) {
        var topPt = sub.box[1] / ((px.height - 1) / src.height);
        var R = Math.min(src.width, src.height) * state.frameSize / 2;
        state.frameY = Math.round(Math.min(0.8, Math.max(0.3, (topPt + R * 0.9) / src.height)) * 100) / 100;
        if (P.frameY.input) syncParam(P.frameY);
      }
      if (P.headOverFrame.input) syncParam(P.headOverFrame);
      setStatus('Turned off "Head breaks out of the frame" and moved the frame up, so the head doesn\'t cover the top text. You can change both in Badge.');
    }
    if (id === 'color') ui.userColor = value;
    if (!NOT_STYLE[id]) ui.edited = true;
    if (P[id] && P[id].input) syncParam(P[id]);
    syncVisibility();
    schedule();
  }

  function applyPreset(key) {
    var pr = PRESETS.filter(function (x) { return x[0] === key; })[0];
    if (!pr) return;
    var typeChanged = pr[1] !== state.type;
    // Presets like "Halftone" bring their own ink/background (white on black); the others
    // go back to the ink colour the user chose, so a white ink never ends up on white paper.
    var keep = { color: ui.userColor };
    KEEP_KEYS.forEach(function (k) { keep[k] = state[k]; });
    state = Object.assign({}, DEFAULTS, { type: pr[1] }, keep, pr[3]);
    ui.preset = key;
    ui.edited = false;
    if (typeChanged) buildPresetTiles();
    syncControls();
    schedule();
  }

  function setType(type) {
    if (state.type === type) return;
    // Each type starts from its first preset: photo settings make poor logos and vice versa.
    applyPreset(PRESETS.filter(function (x) { return x[1] === type; })[0][0]);
  }

  function buildTabs() {
    document.querySelectorAll('#typeSeg button').forEach(function (b) {
      b.addEventListener('click', function () { setType(b.dataset.type); });
    });
    byId('btnResetPreset').addEventListener('click', function () { applyPreset(ui.preset); });
  }

  // Colours for a set of options: ink, optional background layer colour, and the preview paper.
  function paints(o, inkFallback) {
    var ink = o.color || inkFallback;
    if (o.bgFill) return { ink: ink, bg: o.bgColor, paper: o.bgColor };
    if (o.invert && o.type !== "logo") {
      // Legacy invert without a background: preview on dark, black ink shown as paper white.
      return { ink: ink === "#000000" ? "#f3efe6" : ink, bg: undefined, paper: "#111111" };
    }
    return { ink: ink, bg: undefined, paper: "#f3efe6" };
  }

  /* ---------------------------------------------------------- brand text */

  // Used outside Illustrator (browser preview); in Illustrator the real installed fonts replace it.
  var FALLBACK_FONTS = {
    'Arial': [['Regular', 'ArialMT'], ['Bold', 'Arial-BoldMT']],
    'Georgia': [['Regular', 'Georgia'], ['Bold', 'Georgia-Bold']],
    'Times New Roman': [['Regular', 'TimesNewRomanPSMT'], ['Bold', 'TimesNewRomanPS-BoldMT']],
    'Courier New': [['Regular', 'CourierNewPSMT'], ['Bold', 'CourierNewPS-BoldMT']],
    'Verdana': [['Regular', 'Verdana'], ['Bold', 'Verdana-Bold']],
    'Impact': [['Regular', 'Impact']]
  };
  var fonts = { families: FALLBACK_FONTS, loaded: false };
  var RTL = new RegExp('[\\u0590-\\u08FF]');

  // fonts.families: {family: [[style, PostScript name], ...]} from Illustrator (system + Adobe Fonts).
  // fonts.adobe: {family: 'os' | 'apps'} from Creative Cloud's activation list:
  //   'os'   = activated for every app (the panel can draw it itself),
  //   'apps' = activated for Adobe apps only (the preview has to come from Illustrator).
  fonts.adobe = {};
  fonts.count = 0;

  async function loadFonts(force) {
    if (!CEP || (fonts.loaded && !force)) return;
    fonts.loading = true;
    renderFontMenu();
    try {
      var r = await jsx('engraver_fonts()');
      var fams = {}, recs = String(r.list || '').split(String.fromCharCode(2));
      recs.forEach(function (rec) {
        var p = rec.split(String.fromCharCode(1));
        if (p[0]) (fams[p[0]] || (fams[p[0]] = [])).push([p[1], p[2]]);
      });
      if (Object.keys(fams).length) { fonts.families = fams; fonts.loaded = true; fonts.count = recs.length; }
      fonts.adobe = readAdobeFonts(r.adobeFile);
    } catch (e) {
      setStatus('Could not read the installed fonts: ' + e.message, 'err');
    }
    fonts.loading = false;
    renderCache = {};
    if (!fonts.families[state.fontFamily]) state.fontFamily = fonts.families.Arial ? 'Arial' : Object.keys(fonts.families)[0];
    syncFontButton();
    fillStyleOptions();
    renderFontMenu();
    draw();
  }

  // Creative Cloud keeps the activated Adobe Fonts in livetype/c/entitlements.xml.
  function readAdobeFonts(path) {
    var out = {};
    if (!path || !CEP_FS) return out;
    try {
      var r = window.cep.fs.readFile(path);
      if (r.err) return out;
      var re = /<familyName>([^<]*)<\/familyName>[\s\S]*?<installState>([^<]*)<\/installState>/g, m;
      while ((m = re.exec(r.data))) {
        var fam = m[1].replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        if (m[2] === 'OS') out[fam] = 'os';
        else if (!out[fam]) out[fam] = 'apps';
      }
    } catch (e) { /* no Creative Cloud font data: every font is simply listed as installed */ }
    return out;
  }

  function stylesFor(fam) { return fonts.families[fam] || []; }

  function fillStyleOptions() {
    var p = P.fontStyle;
    if (!p || !p.input) return;
    var styles = stylesFor(state.fontFamily);
    if (styles.length && !styles.some(function (st) { return st[0] === state.fontStyle; })) {
      var pref = ['Bold', 'Regular', 'Roman', 'Book', 'Medium'];
      state.fontStyle = (pref.filter(function (n) { return styles.some(function (st) { return st[0] === n; }); })[0]) || styles[0][0];
    }
    p.dd.setOptions((styles.length ? styles : [[state.fontStyle, '']]).map(function (st) { return [st[0], st[0]]; }));
    p.dd.setValue(state.fontStyle);
  }

  function setFontFamily(fam) {
    if (!fonts.families[fam]) return;
    state.fontFamily = fam;
    syncFontButton();
    fillStyleOptions();
    set('fontStyle', state.fontStyle);
  }

  function fontSource(fam) {
    var a = fonts.adobe[fam];
    return a === 'apps' ? 'Adobe Fonts · Adobe apps' : a === 'os' ? 'Adobe Fonts' : '';
  }

  function syncFontButton() {
    var p = P.fontFamily;
    if (!p || !p.input) return;
    p.input.querySelector('.font-btn-name').textContent = state.fontFamily;
    var tag = p.input.querySelector('.font-tag'), src = fonts.adobe[state.fontFamily];
    tag.hidden = !src;
    tag.textContent = 'Adobe';
    tag.title = fontSource(state.fontFamily);
  }

  /* ------------------------------------------------- dropdown & colour picker
   * Native <select> popups and <input type=color> are unreliable inside CEP panels on macOS
   * (the popup opens in the wrong place or not at all; the system colour panel opens behind
   * Illustrator and doesn't report back). Both are drawn by the panel itself, same on every OS. */

  var popup = { el: null, owner: null };

  function closePopup() {
    if (popup.el) popup.el.remove();
    popup.el = popup.owner = null;
  }

  function openPopup(anchor, content, width) {
    closePopup();
    var m = el('div', 'popup'), app = byId('app'), r = anchor.getBoundingClientRect(), appR = app.getBoundingClientRect();
    m.appendChild(content);
    app.appendChild(m);
    var w = Math.min(width || Math.max(r.width, 150), appR.width - 16);
    m.style.width = w + 'px';
    m.style.left = Math.max(8, Math.min(r.left, appR.width - w - 8)) + 'px';
    var below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    m.style.maxHeight = Math.max(120, Math.min(320, Math.max(below, above))) + 'px';
    if (below >= Math.min(m.scrollHeight, 320) || below >= above) m.style.top = (r.bottom + 4) + 'px';
    else m.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    popup.el = m; popup.owner = anchor; popup.top = r.top;
    return m;
  }

  // A button that opens a list. Options: [[value, label], ...].
  function makeDropdown(onPick) {
    var btn = el('button', 'font-btn dd-btn');
    btn.type = 'button';
    btn.innerHTML = '<span class="font-btn-name"></span>' + ICON.chev;
    var dd = { el: btn, options: [], value: '' };
    dd.setOptions = function (opts) { dd.options = opts; dd.setValue(dd.value); };
    dd.setValue = function (v) {
      dd.value = v;
      var o = dd.options.filter(function (x) { return x[0] === v; })[0];
      btn.firstChild.textContent = o ? o[1] : (v || '');
    };
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (popup.owner === btn) { closePopup(); return; }
      var list = el('div', 'dd-list');
      dd.options.forEach(function (o) {
        var it = el('div', 'fm-row' + (o[0] === dd.value ? ' current' : ''));
        var nm = el('span', 'fm-name'); nm.textContent = o[1];
        it.appendChild(nm);
        it.addEventListener('click', function () { closePopup(); dd.setValue(o[0]); onPick(o[0]); });
        list.appendChild(it);
      });
      openPopup(btn, list);
      var cur = list.querySelector('.current');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    });
    return dd;
  }

  function hexToRgb(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, mx ? d / mx : 0, mx];
  }
  function hsvToRgb(h, sat, v) {
    var c = v * sat, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, k = Math.floor(h / 60) % 6;
    var t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k];
    return [(t[0] + m) * 255, (t[1] + m) * 255, (t[2] + m) * 255];
  }

  var SWATCHES = ['#000000', '#262626', '#595959', '#9e9e9e', '#d9d9d9', '#ffffff', '#f3efe6', '#e3ecec', '#c8a96b',
                  '#a3161a', '#e1251b', '#f28c28', '#f2c12e', '#2e7d32', '#0f6b5c', '#1565c0', '#0d2c54', '#6a1b9a'];

  // Colour button + popover with a saturation/brightness square, a hue bar, swatches and a hex field.
  function makeColor(onPick) {
    var btn = el('button', 'color-btn');
    btn.type = 'button';
    btn.innerHTML = '<span class="color-chip"></span><span class="color-hex"></span>';
    var cp = { el: btn, value: '#000000' };
    cp.setValue = function (v) {
      cp.value = v;
      btn.firstChild.style.background = v;
      btn.lastChild.textContent = String(v).toUpperCase();
    };
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (popup.owner === btn) { closePopup(); return; }
      openPopup(btn, colorPanel(cp, onPick), 214);
    });
    return cp;
  }

  function colorPanel(cp, onPick) {
    var rgb = hexToRgb(cp.value) || [0, 0, 0], hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    var wrap = el('div', 'cp');
    var sv = el('canvas', 'cp-sv'), hue = el('canvas', 'cp-hue'), sw = el('div', 'cp-sw'), row = el('div', 'cp-hexrow');
    var hex = el('input', 'text-input cp-hex');
    hex.type = 'text'; hex.spellcheck = false; hex.maxLength = 7;
    row.appendChild(hex);
    wrap.appendChild(sv); wrap.appendChild(hue); wrap.appendChild(sw); wrap.appendChild(row);
    var dpr = Math.min(2, window.devicePixelRatio || 1), W = 198;
    sv.width = W * dpr; sv.height = 118 * dpr; hue.width = W * dpr; hue.height = 12 * dpr;

    function paint() {
      var g = sv.getContext('2d'), w = sv.width, h = sv.height;
      var base = hsvToRgb(hsv[0], 1, 1);
      g.fillStyle = rgbToHex(base[0], base[1], base[2]); g.fillRect(0, 0, w, h);
      var gw = g.createLinearGradient(0, 0, w, 0); gw.addColorStop(0, '#fff'); gw.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gw; g.fillRect(0, 0, w, h);
      var gb = g.createLinearGradient(0, 0, 0, h); gb.addColorStop(0, 'rgba(0,0,0,0)'); gb.addColorStop(1, '#000');
      g.fillStyle = gb; g.fillRect(0, 0, w, h);
      g.lineWidth = 2 * dpr; g.strokeStyle = hsv[2] > 0.55 && hsv[1] < 0.5 ? '#000' : '#fff';
      g.beginPath(); g.arc(hsv[1] * w, (1 - hsv[2]) * h, 5 * dpr, 0, Math.PI * 2); g.stroke();
      var hg = hue.getContext('2d'), hw = hue.width, hh = hue.height, gr = hg.createLinearGradient(0, 0, hw, 0);
      ['#f00', '#ff0', '#0f0', '#0ff', '#00f', '#f0f', '#f00'].forEach(function (c, i) { gr.addColorStop(i / 6, c); });
      hg.fillStyle = gr; hg.fillRect(0, 0, hw, hh);
      hg.fillStyle = '#fff'; hg.fillRect(hsv[0] / 360 * hw - dpr, 0, 2 * dpr, hh);
    }
    function emit(fromHex) {
      var c = hsvToRgb(hsv[0], hsv[1], hsv[2]), v = rgbToHex(c[0], c[1], c[2]);
      if (!fromHex) hex.value = v.toUpperCase();
      cp.setValue(v);
      onPick(v);
      paint();
    }
    function drag(canvas, apply) {
      var on = false;
      function at(ev) {
        var r = canvas.getBoundingClientRect();
        apply(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
        emit();
      }
      canvas.addEventListener('pointerdown', function (ev) { on = true; try { canvas.setPointerCapture(ev.pointerId); } catch (e) {} at(ev); });
      canvas.addEventListener('pointermove', function (ev) { if (on) at(ev); });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (t) { canvas.addEventListener(t, function () { on = false; }); });
    }
    drag(sv, function (x, y) { hsv[1] = x; hsv[2] = 1 - y; });
    drag(hue, function (x) { hsv[0] = Math.min(359.9, x * 360); });
    SWATCHES.forEach(function (c) {
      var b = el('button');
      b.type = 'button'; b.style.background = c; b.title = c.toUpperCase();
      b.addEventListener('click', function () { var q = hexToRgb(c); hsv = rgbToHsv(q[0], q[1], q[2]); emit(); });
      sw.appendChild(b);
    });
    function fromHex() {
      var q = hexToRgb(hex.value);
      if (!q) { hex.value = cp.value.toUpperCase(); return; }
      hsv = rgbToHsv(q[0], q[1], q[2]);
      var v = rgbToHex(q[0], q[1], q[2]);
      cp.setValue(v); onPick(v); paint();
    }
    hex.addEventListener('change', fromHex);
    hex.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { fromHex(); hex.blur(); } });
    hex.value = cp.value.toUpperCase();
    paint();
    return wrap;
  }

  /* ------------------------------------------------------- font picker menu */

  var fontMenu = { el: null, filter: 'all', query: '', active: 0, matches: [] };

  function toggleFontMenu(anchor) {
    if (fontMenu.el && !fontMenu.el.hidden) { closeFontMenu(); return; }
    if (!fontMenu.el) buildFontMenu();
    var m = fontMenu.el, r = anchor.getBoundingClientRect(), appR = byId('app').getBoundingClientRect();
    m.hidden = false;
    var width = Math.min(appR.width - 16, 320);
    m.style.width = width + 'px';
    m.style.left = Math.max(8, Math.min(r.right - width, appR.width - width - 8)) + 'px';
    var below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    var h = Math.min(360, Math.max(below, above));
    m.style.maxHeight = h + 'px';
    if (below >= 220 || below >= above) { m.style.top = (r.bottom + 4) + 'px'; m.style.bottom = 'auto'; }
    else { m.style.bottom = (window.innerHeight - r.top + 4) + 'px'; m.style.top = 'auto'; }
    fontMenu.query = '';
    fontMenu.search.value = '';
    renderFontMenu(true);
    fontMenu.search.focus();
    if (CEP && !fonts.loaded && !fonts.loading) loadFonts();
  }

  function closeFontMenu() {
    if (fontMenu.el) fontMenu.el.hidden = true;
  }

  function buildFontMenu() {
    var m = el('div', 'font-menu');
    m.hidden = true;
    m.innerHTML =
      '<div class="fm-head">' +
        '<input class="fm-search text-input" type="text" placeholder="Search fonts" spellcheck="false">' +
        '<button class="icon-btn sm fm-refresh" title="Reload fonts (after activating new Adobe Fonts)">' +
          '<svg class="i" viewBox="0 0 16 16"><path d="M13 8a5 5 0 11-1.6-3.7M13 2.8v2.7h-2.7"/></svg></button>' +
      '</div>' +
      '<div class="fm-filters seg">' +
        '<button data-f="all" class="on">All</button><button data-f="adobe">Adobe Fonts</button><button data-f="system">System</button>' +
      '</div>' +
      '<div class="fm-count"></div>' +
      '<div class="fm-list" role="listbox"></div>' +
      '<div class="fm-foot"><span class="font-tag">Adobe</span> Adobe Fonts &nbsp; <span class="font-tag apps">Adobe</span> Adobe apps only' +
        ' (preview comes from Illustrator).<br>Activated a new font on fonts.adobe.com? Press ↻.</div>';
    byId('app').appendChild(m);
    fontMenu.el = m;
    fontMenu.search = m.querySelector('.fm-search');
    fontMenu.list = m.querySelector('.fm-list');
    fontMenu.search.addEventListener('input', function () { fontMenu.query = fontMenu.search.value; fontMenu.active = 0; renderFontMenu(); });
    fontMenu.search.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        fontMenu.active = Math.max(0, Math.min(fontMenu.matches.length - 1, fontMenu.active + (ev.key === 'ArrowDown' ? 1 : -1)));
        renderFontMenu();
      } else if (ev.key === 'Enter') {
        var fam = fontMenu.matches[fontMenu.active];
        if (fam) { setFontFamily(fam); closeFontMenu(); }
      } else if (ev.key === 'Escape') {
        ev.stopPropagation();
        closeFontMenu();
      }
    });
    m.querySelector('.fm-refresh').addEventListener('click', function () { loadFonts(true); });
    m.querySelectorAll('.fm-filters button').forEach(function (b) {
      b.addEventListener('click', function () {
        fontMenu.filter = b.dataset.f;
        m.querySelectorAll('.fm-filters button').forEach(function (x) { x.classList.toggle('on', x === b); });
        fontMenu.active = 0;
        renderFontMenu();
      });
    });
    fontMenu.list.addEventListener('mousedown', function (ev) { ev.preventDefault(); });   // keep focus in search
    document.addEventListener('mousedown', function (ev) {
      if (!m.hidden && !m.contains(ev.target) && !ev.target.closest('.font-btn')) closeFontMenu();
    });
  }

  var FONT_ROWS_MAX = 250;

  function renderFontMenu(scrollToCurrent) {
    var m = fontMenu.el;
    if (!m || m.hidden) return;
    var q = fontMenu.query.trim().toLowerCase(), f = fontMenu.filter;
    var all = Object.keys(fonts.families).sort(function (a, b) { return a.localeCompare(b); });
    var matches = all.filter(function (fam) {
      if (f === 'adobe' && !fonts.adobe[fam]) return false;
      if (f === 'system' && fonts.adobe[fam]) return false;
      return !q || fam.toLowerCase().indexOf(q) >= 0;
    });
    if (scrollToCurrent && !q) {
      var cur = matches.indexOf(state.fontFamily);
      fontMenu.active = cur >= 0 ? cur : 0;
    }
    fontMenu.matches = matches;
    var adobeCount = Object.keys(fonts.adobe).filter(function (k) { return fonts.families[k]; }).length;
    m.querySelector('.fm-count').textContent = fonts.loading ? 'Loading fonts from Illustrator…' :
      matches.length.toLocaleString() + ' of ' + all.length.toLocaleString() + ' families' +
      (adobeCount ? ' · ' + adobeCount.toLocaleString() + ' from Adobe Fonts' : '') +
      (CEP ? '' : ' (browser preview list)');
    var list = fontMenu.list;
    list.innerHTML = '';
    // Show a window of rows around the active one so long lists stay fast.
    var startAt = Math.max(0, Math.min(fontMenu.active - 40, matches.length - FONT_ROWS_MAX));
    matches.slice(startAt, startAt + FONT_ROWS_MAX).forEach(function (fam, k) {
      var i = startAt + k, row = el('div', 'fm-row');
      row.setAttribute('role', 'option');
      if (fam === state.fontFamily) row.classList.add('current');
      if (i === fontMenu.active) row.classList.add('active');
      var nm = el('span', 'fm-name'); nm.textContent = fam;
      row.appendChild(nm);
      var src = fonts.adobe[fam];
      if (src) {
        var tag = el('span', 'font-tag' + (src === 'apps' ? ' apps' : ''));
        tag.textContent = 'Adobe';
        tag.title = fontSource(fam);
        row.appendChild(tag);
      }
      var n = el('span', 'fm-styles'); n.textContent = fonts.families[fam].length;
      n.title = fonts.families[fam].length + ' styles';
      row.appendChild(n);
      row.addEventListener('click', function () { setFontFamily(fam); closeFontMenu(); });
      list.appendChild(row);
    });
    if (!matches.length) list.appendChild(note(q ? 'No font matches "' + fontMenu.query + '".' : 'No fonts in this filter.'));
    if (matches.length > FONT_ROWS_MAX) list.appendChild(note('Showing ' + FONT_ROWS_MAX + ' of ' + matches.length.toLocaleString() + ' — type to narrow down.'));
    var act = list.querySelector('.fm-row.active');
    if (act) act.scrollIntoView({ block: 'nearest' });
  }

  /* ------------------------------------------------ exact text preview */

  // Can the panel's own engine draw this family? Compare against two different fallbacks:
  // if the width never changes, the family isn't available and the browser fell back.
  var renderCache = {};
  function canRenderFamily(fam) {
    if (fam in renderCache) return renderCache[fam];
    var c = canRenderFamily.ctx || (canRenderFamily.ctx = el('canvas').getContext('2d'));
    var sample = 'Hamburgefonstiv 0123 WMW ابجد';
    function w(font) { c.font = '40px ' + font; return c.measureText(sample).width; }
    var q = "'" + fam.replace(/'/g, "\\'") + "'";
    var ok = w(q + ', monospace') !== w('monospace') || w(q + ', serif') !== w('serif');
    return (renderCache[fam] = ok);
  }

  // Outlines from Illustrator, keyed by everything that changes their shape.
  var outlineCache = {}, outlineTimer = 0, outlineBusy = false;

  function outlineKey(L) {
    return fontPostScriptName() + '|' + L.items.map(function (it) {
      return [it.s, it.top, it.r.toFixed(1), it.size.toFixed(2), it.tracking].join('~');
    }).join('|');
  }

  function requestOutlines(L) {
    var key = outlineKey(L);
    if (outlineCache[key] || outlineBusy) return;
    clearTimeout(outlineTimer);
    // Wait until typing/dragging settles: each request builds and outlines text in Illustrator.
    outlineTimer = setTimeout(async function () {
      if (busy) { requestOutlines(L); return; }
      outlineBusy = true;
      canvas.ignoreActivateUntil = Date.now() + 3000;
      try {
        var req = { font: fontPostScriptName(), items: L.items.map(function (it) {
          return { s: it.s, top: it.top, r: +it.r.toFixed(3), size: +it.size.toFixed(3), tracking: it.tracking };
        }) };
        var r = await jsx('engraver_textPreview(' + JSON.stringify(JSON.stringify(req)) + ')');
        outlineCache[key] = r.paths;
        draw();
      } catch (e) {
        outlineCache[key] = 'failed';
      } finally {
        outlineBusy = false;
      }
    }, 700);
  }

  // Illustrator path data (y up, relative to the badge centre) → SVG path in image coordinates.
  function outlinesSVG(paths, L, color) {
    var d = [];
    function X(v) { return (L.cx + v).toFixed(2); }
    function Y(v) { return (L.cy - v).toFixed(2); }
    paths.forEach(function (p) {
      var n = (p.length - 1) / 6;
      if (n < 1) return;
      function pt(i) { var o = 1 + i * 6; return p.slice(o, o + 6); }
      var first = pt(0), seg = ['M' + X(first[0]) + ' ' + Y(first[1])];
      for (var i = 1; i < n + (p[0] ? 1 : 0); i++) {
        var a = pt(i - 1), b = pt(i % n);
        seg.push('C' + X(a[4]) + ' ' + Y(a[5]) + ' ' + X(b[2]) + ' ' + Y(b[3]) + ' ' + X(b[0]) + ' ' + Y(b[1]));
      }
      if (p[0]) seg.push('Z');
      d.push(seg.join(''));
    });
    return '<path fill="' + color + '" fill-rule="nonzero" d="' + d.join('') + '"/>';
  }
  function fontPostScriptName() {
    var st = stylesFor(state.fontFamily).filter(function (x) { return x[0] === state.fontStyle; })[0];
    return st ? st[1] : '';
  }

  // CSS equivalent of the chosen family/style, for the preview and SVG export.
  function cssFont() {
    var style = String(state.fontStyle || '').toLowerCase(), weight = 400;
    [[/thin|hairline/, 100], [/extra ?light|ultra ?light/, 200], [/light/, 300], [/medium/, 500],
     [/semi ?bold|demi ?bold/, 600], [/extra ?bold|ultra ?bold/, 800], [/black|heavy/, 900], [/bold/, 700]]
      .some(function (m) { if (m[0].test(style)) { weight = m[1]; return true; } return false; });
    return { family: state.fontFamily, weight: weight, italic: /italic|oblique/.test(style) };
  }

  function escXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fontAttrs(css, size, spacing) {
    return 'font-family="' + escXml("'" + css.family + "'") + '" font-weight="' + css.weight + '"' +
      (css.italic ? ' font-style="italic"' : '') + ' font-size="' + size.toFixed(2) + '" letter-spacing="' + spacing.toFixed(2) + '"';
  }

  function measureText(s, size, spacing, css) {
    var svg = byId('measureSvg');
    svg.innerHTML = '<text ' + fontAttrs(css, size, spacing) + '>' + escXml(s) + '</text>';
    return svg.firstChild.getComputedTextLength();
  }

  // Lay the brand text on the band the engine reserved: fit each text into its half circle
  // and centre its cap height inside the band. Arabic/Hebrew get no tracking (it breaks joining).
  function textLayout(res) {
    var t = res && res.text;
    if (!t || !withText(state)) return null;
    var css = cssFont(), items = [], band = t.outer - t.inner;
    [['topText', true], ['bottomText', false]].forEach(function (d) {
      var s = String(state[d[0]] || '').trim();
      if (!s) return;
      var tracking = RTL.test(s) ? 0 : state.tracking;
      var size = t.size;
      var rMid = (t.outer + t.inner) / 2;
      var len = measureText(s, size, tracking / 1000 * size, css);
      var avail = Math.PI * rMid * 0.86;
      if (len > avail && len > 0) size *= avail / len;
      var cap = size * 0.7;
      var r = d[1] ? t.inner + (band - cap) / 2 : t.outer - (band - cap) / 2;
      items.push({ s: s, top: d[1], r: r, size: size, tracking: tracking });
    });
    return items.length ? { cx: t.cx, cy: t.cy, items: items, css: css } : null;
  }

  function textSVG(L, color, idPrefix) {
    var defs = '', body = '';
    L.items.forEach(function (it, i) {
      var id = idPrefix + i, r = it.r, x0 = (L.cx - r).toFixed(2), x1 = (L.cx + r).toFixed(2), y = L.cy.toFixed(2);
      defs += '<path id="' + id + '" d="M' + x0 + ' ' + y + ' A' + r.toFixed(2) + ' ' + r.toFixed(2) + ' 0 0 ' + (it.top ? 1 : 0) + ' ' + x1 + ' ' + y + '"/>';
      body += '<text ' + fontAttrs(L.css, it.size, it.tracking / 1000 * it.size) + ' fill="' + color + '">' +
        '<textPath href="#' + id + '" xlink:href="#' + id + '" startOffset="50%" text-anchor="middle">' + escXml(it.s) + '</textPath></text>';
    });
    return '<defs>' + defs + '</defs>' + body;
  }

  function drawTextOverlay(cw, ch) {
    var ov = byId('textOverlay'), c = byId('preview');
    var L = src && result ? textLayout(result) : null;
    ui.textLayout = L;
    // <svg> has no .hidden property (that's HTMLElement only), so toggle the attribute itself.
    ov.toggleAttribute('hidden', !L);
    if (!L) { byId('fontHint').hidden = true; return; }
    ov.setAttribute('viewBox', '0 0 ' + src.width + ' ' + src.height);
    ov.style.left = c.offsetLeft + 'px';
    ov.style.top = c.offsetTop + 'px';
    ov.style.width = cw + 'px';
    ov.style.height = ch + 'px';
    var ink = paints(state).ink, hint = byId('fontHint');
    // Fonts the panel can't draw (Adobe Fonts activated for Adobe apps only, some OS quirks):
    // show Illustrator's exact outlines; until they arrive, a faint fallback marks the text position.
    // (The render test is the ground truth: a family can be listed as "Adobe apps only" in
    //  Creative Cloud yet also be installed on the system from another source.)
    if (CEP && fonts.loaded && !canRenderFamily(state.fontFamily)) {
      var shapes = outlineCache[outlineKey(L)];
      if (shapes && shapes !== 'failed') {
        ov.innerHTML = outlinesSVG(shapes, L, ink);
        hint.hidden = true;
      } else {
        ov.innerHTML = '<g opacity=".28">' + textSVG(L, ink, 'bkpv') + '</g>';
        hint.hidden = false;
        hint.textContent = shapes === 'failed' ? 'Font preview unavailable' : 'Loading font from Illustrator…';
        if (!shapes) requestOutlines(L);
      }
      return;
    }
    hint.hidden = true;
    ov.innerHTML = textSVG(L, ink, 'bkpv');
  }

  /* ------------------------------------------------------ style thumbnails */

  function buildPresetTiles() {
    var wrap = byId('presets');
    wrap.innerHTML = '';
    PRESETS.forEach(function (pr) {
      if (pr[1] !== state.type) return;
      var tile = el('button', 'preset');
      tile.dataset.key = pr[0];
      tile.title = pr[2];
      var th = el('span', 'th ph');
      var c = el('canvas'), td = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(148 * td); c.height = Math.round(124 * td);
      th.appendChild(c);
      var nm = el('span', 'nm'); nm.textContent = pr[2];
      tile.appendChild(th); tile.appendChild(nm);
      tile.addEventListener('click', function () { applyPreset(pr[0]); });
      wrap.appendChild(tile);
      pr.tile = tile;
      if (PRO && PRO.decorateTile) PRO.decorateTile(tile, pr);
    });
    if (PRO && PRO.afterTiles) PRO.afterTiles(wrap);
    syncVisibility();
    renderThumbs();
  }

  function thumbPixels() {
    if (src.thumbPx) return src.thumbPx;
    var img = src.img, s = Math.min(1, THUMB_RES / Math.max(img.naturalWidth, img.naturalHeight));
    var c = el('canvas');
    c.width = Math.max(2, Math.round(img.naturalWidth * s));
    c.height = Math.max(2, Math.round(img.naturalHeight * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return (src.thumbPx = c.getContext('2d').getImageData(0, 0, c.width, c.height));
  }

  function renderThumbs() {
    var job = ++ui.thumbJob;
    var list = PRESETS.filter(function (pr) { return pr[1] === state.type && pr.tile; });
    list.forEach(function (pr) {
      var th = pr.tile.firstChild;
      th.classList.toggle('ph', !src);
      th.classList.toggle('loading', !!src);
      if (!src) th.firstChild.getContext('2d').clearRect(0, 0, 148, 124);
    });
    if (!src) return;
    var i = 0;
    (function next() {
      if (job !== ui.thumbJob || i >= list.length) return;
      try { renderThumb(list[i]); } catch (e) { /* a thumbnail is never worth an error */ }
      list[i].tile.firstChild.classList.remove('loading');
      i++;
      setTimeout(next, 0);
    })();
  }

  function renderThumb(pr) {
    var px = thumbPixels(), type = pr[1];
    var k = THUMB_RES / WORK_RES[type];
    var o = Object.assign({}, DEFAULTS, pr[3], { type: type });
    o.blur = Math.round(o.blur * k);
    o.silhouetteSmooth = Math.max(1, Math.round(o.silhouetteSmooth * k));
    o.lines = Math.max(28, Math.round(o.lines * 0.5));      // readable at thumbnail size
    var input = { tone: E.toneMap(px, o), img: px };
    if (type === 'logo') input.sdf = E.logoField(px, o);
    if (type === 'portrait') input.sdf = E.subjectField(px, o);
    var res = E.generate(input, src.width, src.height, o);

    var c = pr.tile.firstChild.firstChild, ctx = c.getContext('2d');
    // Frame: whole image for photos and badges, just the shape for logos (they sit in empty space).
    var x0 = 0, y0 = 0, W = src.width, H = src.height;
    if (type === 'logo' && !input.sdf.empty) {
      var b = input.sdf.box, gx = src.width / px.width, gy = src.height / px.height, pad = 0.08;
      x0 = b[0] * gx; y0 = b[1] * gy; W = (b[2] - b[0] + 1) * gx; H = (b[3] - b[1] + 1) * gy;
      x0 -= W * pad; y0 -= H * pad; W *= 1 + 2 * pad; H *= 1 + 2 * pad;
    }
    var s = type === 'photo' ? Math.max(c.width / W, c.height / H) : Math.min(c.width / W, c.height / H) * 0.94;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var pt = paints(Object.assign({}, o, { color: pr[3].color || "#111111" }));
    ctx.fillStyle = pt.paper;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(s, 0, 0, s, (c.width - W * s) / 2 - x0 * s, (c.height - H * s) / 2 - y0 * s);
    E.draw(ctx, res, pt.ink, pt.bg);
  }

  /* -------------------------------------------------------------- source */

  // decoded: an Image already decoded from `url` (saves decoding a large photo twice).
  function loadImage(url, meta, decoded) {
    showBusy('Reading image…');
    var img = decoded || new Image();
    function ready() {
      src = {
        img: img,
        name: meta.name || 'image',
        origin: meta.origin || 'Image',
        width: meta.width || img.naturalWidth,
        height: meta.height || img.naturalHeight,
        fromSelection: !!meta.fromSelection,
        grids: {}
      };
      maps = {}; mapKeys = {};
      byId('empty').hidden = true;
      byId('preview').hidden = false;
      byId('stageTools').hidden = false;
      updateSourceCard();
      hideBusy();
      regenerate();
      renderThumbs();
    }
    if (decoded) { ready(); return; }
    img.onload = ready;
    img.onerror = function () { hideBusy(); setStatus('Could not read that image (' + (meta.name || 'image') + ').', 'err'); };
    img.src = url;
  }

  function updateSourceCard() {
    var th = byId('srcThumb');
    th.innerHTML = '';
    var c = el('canvas');
    c.width = 68; c.height = 68;
    var img = src.img, s = Math.max(68 / img.naturalWidth, 68 / img.naturalHeight);
    c.getContext('2d').drawImage(img, (68 - img.naturalWidth * s) / 2, (68 - img.naturalHeight * s) / 2,
      img.naturalWidth * s, img.naturalHeight * s);
    th.appendChild(c);
    byId('srcName').textContent = src.name;
    byId('srcName').title = src.name;
    byId('srcMeta').textContent = src.origin + ' · ' + Math.round(src.width) + ' × ' + Math.round(src.height) + ' pt';
  }

  // Source pixels at the working resolution for the current type (alpha kept for logo masks).
  function grid(res) {
    res = res || WORK_RES[state.type];
    if (src.grids[res]) return src.grids[res];
    var img = src.img;
    var s = Math.min(1, res / Math.max(img.naturalWidth, img.naturalHeight));
    var c = el('canvas');
    c.width = Math.max(2, Math.round(img.naturalWidth * s));
    c.height = Math.max(2, Math.round(img.naturalHeight * s));
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return (src.grids[res] = ctx.getImageData(0, 0, c.width, c.height));
  }

  function mimeFor(path) {
    var ext = (path.split('.').pop() || '').toLowerCase();
    return { jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' }[ext] || 'image/png';
  }

  // A URL the preview can decode: base64 data via cep.fs, or a file URL (the manifest
  // enables --allow-file-access-from-files, so canvas can still read its pixels).
  function localURL(path) {
    if (!CEP_FS) {
      // Windows "C:/…" needs file:///C:/…, macOS "/Users/…" needs file:///Users/…
      var p = path.replace(/\\/g, '/').replace(/^\/+/, '');
      return 'file:///' + encodeURI(p).replace(/#/g, '%23');
    }
    var r = window.cep.fs.readFile(path, window.cep.encoding.Base64);
    if (r.err) throw new Error('Could not read ' + path + ' (error ' + r.err + ')');
    return 'data:' + mimeFor(path) + ';base64,' + r.data;
  }

  function loadLocalFile(path, meta) {
    loadImage(localURL(path), meta);
  }

  function decode(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }

  // Load a capture result from the host. `recapture(force)` builds the host call again.
  async function loadCapture(r, key, origin, recapture) {
    var url, decoded = null;
    try {
      url = localURL(r.path);
      if (r.direct) {
        // The linked file must look like what Illustrator shows. EXIF-rotated JPEGs, formats the
        // panel can't decode, or a non-uniformly scaled image don't: let Illustrator render the pixels.
        var img = await decode(url), want = r.width / r.height;
        if (!img || Math.abs(img.naturalWidth / img.naturalHeight - want) / want > 0.03) {
          r = await jsx(recapture(true));
          url = localURL(r.path);
        } else {
          decoded = img;
        }
      }
    } finally {
      if (r && !r.direct && CEP_FS) window.cep.fs.deleteFile(r.path);  // temp export; never the user's linked file
    }
    loadImage(url, { name: r.name, width: r.width, height: r.height, fromSelection: true, origin: r.direct ? 'Linked' : origin }, decoded);
    canvas.loadedKey = key;
    // The capture reports the selection it left behind, so the poller won't load it twice.
    if (r.sel !== undefined) canvas.lastSel = canvas.loadedSel = r.sel;
    refreshImageList();
  }

  async function useSelection(auto) {
    if (busy) return;
    closeMenu();
    showBusy(auto === true ? 'Loading selected image…' : 'Capturing selection…');
    try {
      var call = function (force) { return 'engraver_exportSelection(' + !!force + ')'; };
      var r = await jsx(call(false));
      await loadCapture(r, 'sel:' + r.sel, 'Selection', call);
    } catch (e) {
      hideBusy();
      setStatus(e.message, 'err');
    }
  }

  async function useListImage(item) {
    if (busy) return;
    closeMenu();
    showBusy('Loading "' + item.name + '"…');
    try {
      var call = function (force) {
        return 'engraver_captureImage(' + JSON.stringify(item.kind) + ',' + item.index + ',' + !!force + ')';
      };
      var r = await jsx(call(false));
      await loadCapture(r, item.kind + ':' + item.index, item.kind === 'placed' ? 'Linked' : 'Embedded', call);
    } catch (e) {
      hideBusy();
      setStatus(e.message, 'err');
    }
  }

  /* ------------------------------------------------------- canvas images */

  var canvas = { doc: null, items: [], listKey: '', lastSel: null, loadedSel: null, loadedKey: '', polling: false };

  async function refreshImageList() {
    try {
      var r = await jsx('engraver_listImages()');
      canvas.doc = r.doc;
      canvas.items = r.items;
    } catch (e) {
      canvas.doc = null; canvas.items = [];
    }
    renderImageList();
  }

  function renderImageList() {
    var list = byId('imageList');
    list.innerHTML = '';
    byId('docName').textContent = canvas.doc || '—';
    if (!canvas.doc) {
      list.appendChild(note('Open a document in Illustrator.'));
      return;
    }
    if (!canvas.items.length) {
      list.appendChild(note('No images in this document.\nPlace one with File › Place, or select any artwork and use the selection button.'));
      return;
    }
    canvas.items.forEach(function (it) {
      var row = el('button', 'img-row');
      var key = it.kind + ':' + it.index;
      var fromSel = canvas.loadedKey.indexOf('sel:') === 0 && it.selected;
      if (key === canvas.loadedKey || fromSel) row.classList.add('active');
      if (it.hidden) row.classList.add('is-hidden');
      row.title = (it.linked ? 'Linked: ' + it.linked : 'Embedded image') + (it.hidden ? ' (hidden)' : '');
      row.appendChild(el('span', 'ico', it.kind === 'placed' ? ICON.linked : ICON.embedded));
      var name = el('span', 'nm'); name.textContent = it.name;
      var dim = el('span', 'dim'); dim.textContent = it.w + '×' + it.h + (it.hidden ? ' · hidden' : '');
      row.appendChild(name); row.appendChild(dim);
      row.addEventListener('click', function () { useListImage(it); });
      list.appendChild(row);
    });
  }

  function note(text) { var n = el('div', 'img-note'); n.style.whiteSpace = 'pre-line'; n.textContent = text; return n; }

  function openMenu() {
    if (!CEP || busy) return;
    byId('srcMenu').hidden = false;
    byId('srcCard').classList.add('open');
    refreshImageList();
  }
  function closeMenu() {
    byId('srcMenu').hidden = true;
    byId('srcCard').classList.remove('open');
  }

  // Illustrator has no selection-changed event for panels, so poll a cheap snapshot.
  async function poll() {
    if (busy || canvas.polling || document.hidden) return;
    canvas.polling = true;
    try {
      var r = await jsx('engraver_poll()');
      var listKey = r.doc + '|' + r.images;
      if (listKey !== canvas.listKey) { canvas.listKey = listKey; refreshImageList(); }
      if (r.sel !== canvas.lastSel) {
        canvas.lastSel = r.sel;
        if (r.selIsImage && byId('followSel').checked && r.sel !== canvas.loadedSel) useSelection(true);
      }
    } catch (e) { /* Illustrator busy (dialog open, etc.): try again next tick */ }
    finally { canvas.polling = false; }
  }

  function openImage() {
    closeMenu();
    if (!CEP_FS) { byId('fileInput').click(); return; }
    var r = window.cep.fs.showOpenDialogEx(false, false, 'Open image', '', ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']);
    if (r.err || !r.data || !r.data.length) return;
    try {
      var path = r.data[0];
      loadLocalFile(path, { name: path.split(/[\\/]/).pop(), origin: 'File' });
    } catch (e) {
      setStatus(e.message, 'err');
    }
  }

  /* ------------------------------------------------------------- render */

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(regenerate, 30);
  }

  // Staged cache. Analysis maps (tone, logo / person fields) are keyed on the settings they read and on
  // the working resolution; the geometry is keyed on every setting except the post-only ones (colours,
  // effects), so changing a colour reruns only the post stage. Each map keeps one entry per resolution,
  // so the preview and a higher-quality output don't evict each other.
  var POST_KEYS = { color: true, bgColor: true, hideSource: true, textOutline: true };
  if (PRO && PRO.postKeys) PRO.postKeys.forEach(function (k) { POST_KEYS[k] = true; });

  function cached(name, keys, o, build) {
    var key = keys.map(function (k) { return o[k]; }).join('|');
    if (mapKeys[name] !== key) { maps[name] = build(); mapKeys[name] = key; }
    return maps[name];
  }

  // Working resolution for a quality factor (1 = the standard preview). Pixel-based settings (blur,
  // edge smoothing) are scaled with it, so a coarser or finer analysis keeps the same look.
  function workRes(type, q) { return Math.max(64, Math.round(WORK_RES[type] * (q || 1))); }
  function scaledOpts(o, k) {
    if (k === 1) return o;
    var c = Object.assign({}, o);
    c.blur = Math.round((o.blur || 0) * k);
    if (o.silhouetteSmooth) c.silhouetteSmooth = Math.max(1, Math.round(o.silhouetteSmooth * k));
    return c;
  }

  function analysisInput(o, q) {
    var res = workRes(o.type, q), px = grid(res), oo = scaledOpts(o, res / WORK_RES[o.type]);
    var input = { tone: cached('tone' + res, TONE_KEYS, oo, function () { return E.toneMap(px, oo); }), img: px };
    if (o.type === 'logo') input.sdf = cached('sdf' + res, MASK_KEYS, oo, function () { return E.logoField(px, oo); });
    else if (o.type === 'portrait') input.sdf = cached('subject' + res, SUBJECT_KEYS, oo, function () { return E.subjectField(px, oo); });
    if (PRO && PRO.inputs) PRO.inputs(input, oo);
    return { input: input, o: oo, res: res };
  }

  function geomKey(o, res) {
    var g = {};
    Object.keys(o).forEach(function (k) { if (!POST_KEYS[k]) g[k] = o[k]; });
    return res + '|' + (PRO && PRO.inputsKey ? PRO.inputsKey() : '') + '|' + JSON.stringify(g);
  }

  // Full pipeline for settings `o` at quality q: analysis -> geometry (cached) -> post stage.
  // Pro may adjust the settings after a run (path budget) and ask for another one; the cache keeps
  // the final geometry under the key of the settings that were asked for.
  function compute(o, q) {
    var a = analysisInput(o, q), key = geomKey(a.o, a.res), slot = 'geom' + a.res;
    var hit = !!(maps[slot] && maps[slot].key === key), W = src.width, H = src.height;
    var geom = hit ? maps[slot].geom : null, gen = hit ? maps[slot].opts : a.o, note = hit ? maps[slot].note : null, res;
    for (var it = 0; it < 6; it++) {
      if (!geom) geom = PRO && PRO.generate ? PRO.generate(a.input, W, H, gen, E) : E.generate(a.input, W, H, gen, { noPost: true });
      res = E.post(geom, a.o);
      if (hit || !(PRO && PRO.adjust)) break;
      var next = PRO.adjust(res, gen, it);
      if (!next) break;
      note = next.note; gen = next.opts; geom = null;
    }
    maps[slot] = { key: key, geom: geom, opts: gen, note: note };
    res.note = note;
    res.opts = gen;
    return { result: res, input: a.input, o: a.o };
  }

  function regenerate() {
    if (!src) { updateActions(); return; }
    var t0 = performance.now();
    try {
      var run = compute(state, previewQ()), input = run.input;
      if (state.type === 'logo' && input.sdf.empty) setStatus('No logo shape found. Try raising "Background tolerance".', 'err');
      else if (state.type === 'portrait' && input.sdf.empty) setStatus('No person found. Lower "Background tolerance" or turn off "Remove background".', 'err');
      result = run.result;
      if (PRO && PRO.afterRegenerate) PRO.afterRegenerate(result);
    } catch (e) {
      // Keep the last good preview instead of failing silently inside a timer.
      setStatus('Could not update the preview: ' + e.message, 'err');
      updateActions();
      return;
    }
    draw();
    var st = result.stats;
    byId('stats').textContent = st.paths.toLocaleString() + ' paths · ' +
      (st.points / 1000).toFixed(1) + 'k pts · ' + Math.round(performance.now() - t0) + ' ms';
    updateActions();
  }

  function draw() {
    if (!src || !result) return;
    var c = byId('preview'), stage = byId('stage');
    var maxW = stage.clientWidth - 24, maxH = ui.fullPreview ? Math.max(200, window.innerHeight - 150)
                                         : Math.max(150, Math.min(window.innerHeight * 0.4, 560));
    var s = Math.min(maxW / src.width, maxH / src.height);
    var cw = Math.max(1, Math.round(src.width * s)), ch = Math.max(1, Math.round(src.height * s));
    var dpr = window.devicePixelRatio || 1;
    var pt = paints(state);
    c.style.width = cw + 'px'; c.style.height = ch + 'px';
    c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
    // The artwork is rendered once into an offscreen canvas; dragging the Compare split only
    // recomposites (redrawing tens of thousands of marks per mouse move was very slow, worst on Retina).
    var art = ui.art || (ui.art = el('canvas'));
    art.width = c.width; art.height = c.height;
    var actx = art.getContext('2d');
    actx.setTransform(1, 0, 0, 1, 0, 0);
    actx.fillStyle = pt.paper;
    actx.fillRect(0, 0, art.width, art.height);
    var v = ui.view, z = v.z || 1;
    if (z > 1) actx.setTransform(dpr * s * z, 0, 0, dpr * s * z, dpr * (cw / 2 - s * z * v.cx), dpr * (ch / 2 - s * z * v.cy));
    else actx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
    E.draw(actx, result, pt.ink, pt.bg);
    drawTextOverlay(cw, ch);
    byId('textOverlay').style.visibility = z > 1 ? 'hidden' : '';
    ui.cw = cw; ui.ch = ch; ui.s = s;
    composite();
    if (PRO && PRO.afterDraw) PRO.afterDraw();
  }

  function composite() {
    var c = byId('preview'), stage = byId('stage'), cw = ui.cw, ch = ui.ch;
    if (!src || !ui.art || !cw) return;
    var ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(ui.art, 0, 0);
    if (PRO && PRO.afterComposite) PRO.afterComposite(ctx, c);
    var line = byId('splitLine'), before = byId('tagBefore'), after = byId('tagAfter');
    stage.classList.toggle('comparing', ui.compare);
    line.hidden = before.hidden = after.hidden = !ui.compare;
    if (!ui.compare) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(0, 0, c.width * ui.split, c.height);
    ctx.clip();
    var v = ui.view, z = v.z || 1, dpr = c.width / cw;
    if (z > 1) {
      ctx.setTransform(dpr * ui.s * z, 0, 0, dpr * ui.s * z, dpr * (cw / 2 - ui.s * z * v.cx), dpr * (ch / 2 - ui.s * z * v.cy));
      ctx.drawImage(src.img, 0, 0, src.width, src.height);
    } else ctx.drawImage(src.img, 0, 0, c.width, c.height);
    ctx.restore();
    line.style.left = (c.offsetLeft + cw * ui.split) + 'px';
    line.style.top = c.offsetTop + 'px';
    line.style.bottom = 'auto';
    line.style.height = ch + 'px';
    before.style.left = (c.offsetLeft + 6) + 'px';
    before.style.top = after.style.top = (c.offsetTop + 6) + 'px';
    after.style.left = (c.offsetLeft + cw - 6 - after.offsetWidth) + 'px';
  }

  function bindCompare() {
    var c = byId('preview'), dragging = false, frame = 0;
    function move(ev) {
      var r = c.getBoundingClientRect();
      if (!r.width) return;
      ui.split = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      if (document.hidden) { composite(); return; }                      // no animation frames while hidden
      if (!frame) frame = requestAnimationFrame(function () { frame = 0; composite(); });
    }
    byId('btnCompare').addEventListener('click', function () {
      ui.compare = !ui.compare;
      ui.split = 0.5;
      this.classList.toggle('on', ui.compare);
      composite();
    });
    c.addEventListener('pointerdown', function (ev) {
      if (!ui.compare) return;
      dragging = true;
      try { c.setPointerCapture(ev.pointerId); } catch (e) {}
      move(ev);
    });
    c.addEventListener('pointermove', function (ev) { if (dragging) move(ev); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (t) {
      c.addEventListener(t, function () { dragging = false; });
    });
  }

  /* ------------------------------------------------------------- output */

  function jsx(code) {
    return new Promise(function (resolve, reject) {
      window.__adobe_cep__.evalScript(code, function (res) {
        var o;
        try { o = JSON.parse(res); } catch (e) {
          return reject(new Error('Illustrator script error: ' + res));
        }
        if (!o.ok) return reject(new Error(o.error));
        resolve(o);
      });
    });
  }

  // Pure-K value for CMYK documents when a layer's colour is a black/white mix, else -1.
  function blackK(layer, ink, bg) {
    var base = bg || '#ffffff';
    if (layer.color) return layer.color === '#000000' ? 100 : layer.color === '#ffffff' ? 0 : -1;
    if (layer.paint === 'bg') return base === '#000000' ? 100 : base === '#ffffff' ? 0 : -1;
    var t = layer.tint != null ? layer.tint : 1;
    if (ink === '#000000' && base === '#ffffff') return Math.round(t * 100);
    if (ink === '#ffffff' && base === '#000000') return Math.round((1 - t) * 100);
    return -1;
  }

  // The build data is JavaScript source that host.jsx evaluates, so every value goes in as a literal:
  // strings through JSON (U+2028/2029 escaped too - raw, they end a line in ExtendScript), numbers checked.
  // Nothing from a style file or a text field can then be read as code.
  function lit(v) {
    return JSON.stringify(v == null ? '' : v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }
  function num(v) { v = +v; return isFinite(v) ? v : 0; }

  function hostData(res, place, hide) {
    var sc = place.scale, f2 = function (v) { return v.toFixed(2); };
    var bg = state.bgFill ? state.bgColor : undefined;
    var out = ['({color:', lit(state.color), ',hideSource:', hide ? 'true' : 'false', ',swatches:', !!state.swatches, ',layers:['];
    res.layers.forEach(function (layer, li) {
      out.push(li ? ',' : '', '{name:', lit(layer.name), ',color:', lit(E.layerColor(layer, state.color, bg)),
        ',k:', blackK(layer, state.color, bg), ',stroke:',
        ((layer.stroke || 0) * sc).toFixed(3), ',open:', !!layer.open, ',evenodd:', !!layer.evenodd);
      if (layer.opacity != null) out.push(',opacity:', num(layer.opacity).toFixed(3));
      if (layer.blend) out.push(',blend:', lit(layer.blend));
      if (layer.cap) out.push(',cap:', lit(layer.cap));
      if (layer.compound) out.push(',compound:true');
      if (layer.cmyk) out.push(',cmyk:[', layer.cmyk.map(function (v) { return num(v).toFixed(1); }).join(','), ']');
      if (layer.ink) out.push(',ink:', lit(layer.ink));
      if (layer.instances) {
        // Particles: x, y in document points, size = longest side (pt), rotation in degrees (y points up there).
        var di = layer.instances, inst = new Array(di.length);
        for (var ii = 0; ii < di.length; ii += 4) {
          inst[ii] = f2(place.left + di[ii] * sc); inst[ii + 1] = f2(place.top - di[ii + 1] * sc);
          inst[ii + 2] = (di[ii + 2] * sc).toFixed(3); inst[ii + 3] = (-di[ii + 3] * 180 / Math.PI).toFixed(2);
        }
        out.push(',inst:"', inst.join(','), '",particle:', lit(layer.asSymbols ? 'symbol' : 'paths'), ',recolor:', !!layer.recolor);
      }
      if (layer.gradient) {
        var g = layer.gradient, X = function (x) { return f2(place.left + x * sc); }, Y = function (y) { return f2(place.top - y * sc); };
        out.push(',gradient:{type:', lit(g.type || 'linear'),
          g.type === 'radial' ? ',cx:' + X(g.cx) + ',cy:' + Y(g.cy) + ',r:' + f2(g.r * sc)
                              : ',x1:' + X(g.x1) + ',y1:' + Y(g.y1) + ',x2:' + X(g.x2) + ',y2:' + Y(g.y2),
          ',stops:[', g.stops.map(function (st) { return '[' + num(st[0]).toFixed(3) + ',' + lit(st[1]) + ']'; }).join(','), ']}');
      }
      if (layer.rect) {
        var rc = layer.rect;
        out.push(',rect:[', f2(place.left + rc[0] * sc), ',', f2(place.top - rc[1] * sc), ',', f2(rc[2] * sc), ',', f2(rc[3] * sc), ']');
      }
      if (layer.dots) {
        var d = layer.dots, nums = new Array(d.length);
        for (var j = 0; j < d.length; j += 3) {
          nums[j] = f2(place.left + d[j] * sc);
          nums[j + 1] = f2(place.top - d[j + 1] * sc);
          nums[j + 2] = (d[j + 2] * sc).toFixed(3);
        }
        // Numbers go as strings: ExtendScript reads eval'd array literals very slowly (see host.jsx).
        out.push(',shape:', lit(layer.shape), ',dots:"', nums.join(','), '"');
      }
      if (layer.glyphs) {
        var gl = layer.glyphs, gn = new Array(gl.length);
        for (var gi = 0; gi < gl.length; gi += 4) {
          gn[gi] = f2(place.left + gl[gi] * sc); gn[gi + 1] = f2(place.top - gl[gi + 1] * sc);
          gn[gi + 2] = (gl[gi + 2] * sc).toFixed(3); gn[gi + 3] = gl[gi + 3];
        }
        out.push(',glyphs:"', gn.join(','), '",chars:', lit(layer.chars), ',font:', lit(fontPostScriptName()));
        if (layer.grot) out.push(',grot:"', layer.grot.map(function (a) { return (-num(a)).toFixed(1); }).join(','), '"');
      }
      out.push(',polys:"');
      layer.polys.forEach(function (q, qi) {
        var pts = new Array(q.length);
        for (var i = 0; i < q.length; i += 2) {
          pts[i] = (place.left + q[i] * sc).toFixed(2);
          pts[i + 1] = (place.top - q[i + 1] * sc).toFixed(2);
        }
        out.push(qi ? ';' : '', pts.join(','));
      });
      out.push('"}');
    });
    out.push(']');
    var L = textLayout(res);
    if (L) {
      // Brand text: Illustrator builds real text on half-circle paths from these values.
      out.push(',text:{cx:', f2(place.left + L.cx * sc), ',cy:', f2(place.top - L.cy * sc),
        ',font:', lit(fontPostScriptName()), ',color:', lit(state.color), ',k:', blackK({}, state.color, bg),
        ',outline:', !!state.textOutline, ',items:[');
      L.items.forEach(function (it, i) {
        out.push(i ? ',' : '', '{s:', lit(it.s), ',top:', !!it.top, ',r:', f2(it.r * sc),
          ',size:', f2(it.size * sc), ',tracking:', num(it.tracking), '}');
      });
      out.push(']}');
    }
    // Pro build options (recipe metadata, ink layers, batch naming...) travel in one `pro` object, last.
    var extra = PRO && PRO.hostExtra ? PRO.hostExtra(res, place) : '';
    if (extra) out.push(',pro:', extra);
    out.push('})');
    return out.join('');
  }

  // Preview quality factor (Pro: Fast / Balanced / Accurate); 1 = the standard working resolution.
  function previewQ() { return PRO && PRO.previewQuality ? PRO.previewQuality() : 1; }

  // Sends a result to Illustrator: placement, data transport (temp file, or chunks without a file API)
  // and the build. Used by Create vector and by Pro's batch / update. Returns the host's reply.
  async function buildResult(res) {
    var place = await jsx('engraver_placement(' + src.width + ',' + src.height + ',' + src.fromSelection + ')');
    var data = hostData(res, place, state.hideSource && place.fromSource);
    var t0 = performance.now(), r;
    if (CEP_FS) {
      var tmp = await jsx('engraver_tempFolder()');
      var file = tmp.path + '/azmeel_data_' + Date.now() + '.txt';
      var w = window.cep.fs.writeFile(file, data);
      if (w.err) throw new Error('Could not write temp data (error ' + w.err + ')');
      r = await jsx('engraver_build(' + JSON.stringify(file) + ')');
    } else {
      // No file API: stream the data through evalScript in chunks.
      await jsx('engraver_chunkReset()');
      for (var i = 0; i < data.length; i += 400000) {
        await jsx('engraver_chunk(' + JSON.stringify(data.slice(i, i + 400000)) + ')');
      }
      r = await jsx('engraver_buildChunks()');
    }
    r.seconds = (performance.now() - t0) / 1000;
    r.place = place;
    return r;
  }

  // The result to build: the preview's, or the same settings again at the output quality.
  async function outputResult() {
    var res = result, outQ = PRO && PRO.outputQuality ? PRO.outputQuality() : 0;
    if (outQ && outQ !== previewQ()) {
      showBusy('Computing the full-quality vectors…');
      await new Promise(function (r) { setTimeout(r, 40); });
      res = compute(state, outQ).result;
    }
    return res;
  }

  async function createVector() {
    if (busy) return;
    if (!result) { setStatus('Load an image first.', 'err'); return; }
    showBusy('Building ' + result.stats.paths.toLocaleString() + ' paths in Illustrator…');
    await new Promise(function (r) { setTimeout(r, 40); });
    try {
      var res = await outputResult();
      if (PRO && PRO.beforeCreate) {
        var stop = PRO.beforeCreate(res);
        if (stop) { setStatus(stop, 'err'); return; }
      }
      showBusy('Building ' + res.stats.paths.toLocaleString() + ' paths in Illustrator…');
      await new Promise(function (r) { setTimeout(r, 40); });
      var r = await buildResult(res), place = r.place;
      var msg = (r.replaced ? 'Updated the artwork: ' : 'Created ') + r.paths.toLocaleString() + ' paths' +
        (r.replaced ? '' : ' on layer "' + (r.layer || 'Engraving') + '"') + ' in ' + r.seconds.toFixed(1) + ' s.';
      if (src.fromSelection && !place.fromSource && !r.replaced) {
        msg += ' The original image wasn\'t found in this document, so it was placed on the artboard.';
      }
      if (res.note) msg += ' ' + res.note;
      if (res.postNote) msg += ' ' + res.postNote;
      if (r.inks) msg += ' Inks on ' + r.inks + ' separate layers.';
      if (r.simplified) {
        msg += ' ' + r.simplified.toLocaleString() + ' very large shape' + (r.simplified > 1 ? 's were' : ' was') +
          ' simplified slightly to fit Illustrator’s 32,000-point limit per path.';
      }
      if (r.skipped) {
        // host.jsx keeps the data in azmeel_skipped_shapes.txt (temp folder) for diagnosis.
        msg += ' ' + r.skipped.toLocaleString() + ' shape' + (r.skipped > 1 ? 's were' : ' was') +
          ' skipped because Illustrator rejected ' + (r.skipped > 1 ? 'them' : 'it') + ' (' + r.skipInfo + ').';
      }
      setStatus(msg, (src.fromSelection && !place.fromSource && !r.replaced) || r.skipped ? 'err' : 'ok');
      if (PRO && PRO.afterCreate) PRO.afterCreate(r);
      refreshImageList();
    } catch (e) {
      setStatus(e.message, 'err');
    } finally {
      hideBusy();
    }
  }

  function exportSVG() {
    if (!result) { setStatus('Load an image first.', 'err'); return; }
    var svg = E.toSVG(result, state.color, state.bgFill ? state.bgColor : undefined);
    var L = textLayout(result);
    if (L) {
      svg = svg.replace('<svg xmlns="http://www.w3.org/2000/svg"', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"')
               .replace(/<\/svg>$/, textSVG(L, state.color, 'bktext') + '\n</svg>');
    }
    var base = (src.name || 'engraving').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_') + '_engraving.svg';
    if (CEP_FS) {
      var r = window.cep.fs.showSaveDialogEx('Export SVG', '', ['svg'], base);
      if (r.err || !r.data) return;
      var path = /\.svg$/i.test(r.data) ? r.data : r.data + '.svg';
      var w = window.cep.fs.writeFile(path, svg);
      setStatus(w.err ? 'Could not save SVG (error ' + w.err + ')' : 'Saved ' + path, w.err ? 'err' : 'ok');
      return;
    }
    var a = el('a');
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    a.download = base;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* ------------------------------------------------------------- chrome */

  // Keys the panel needs while it has focus. Without this, Illustrator takes them: on the Mac,
  // arrows nudge the selected artwork and Delete removes it while you type in a field.
  function registerKeys() {
    var keys = [];
    function add(codes, mods) { codes.forEach(function (k) { keys.push(Object.assign({ keyCode: k }, mods || {})); }); }
    if (MAC) {
      var plain = [51, 117, 36, 76, 53, 48, 123, 124, 125, 126, 115, 119, 116, 121];   // delete, fwd-del, return, enter, esc, tab, arrows, home/end/pgup/pgdn
      add(plain); add(plain, { shiftKey: true });
      add([0, 6, 7, 8, 9], { metaKey: true });                                        // Cmd+A Z X C V
      add([6], { metaKey: true, shiftKey: true });                                    // Cmd+Shift+Z
      add([123, 124], { metaKey: true }); add([123, 124], { altKey: true });          // word / line jumps
    } else {
      var w = [8, 9, 13, 27, 33, 34, 35, 36, 37, 38, 39, 40, 46];
      add(w); add(w, { shiftKey: true });
      add([65, 67, 86, 88, 89, 90], { ctrlKey: true });
      add([37, 39], { ctrlKey: true });
    }
    if (PRO && PRO.keys) PRO.keys(add, MAC);
    try { window.__adobe_cep__.registerKeyEventsInterest(JSON.stringify(keys)); } catch (e) { logError('keys: ' + e.message); }
  }

  function copyText(text) {
    var t = el('textarea');
    t.value = text;
    t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    t.remove();
    return ok;
  }

  function diagnostics() {
    var env = {};
    try { env = JSON.parse(window.__adobe_cep__.getHostEnvironment()); } catch (e) {}
    return [
      'Azmeel ' + VERSION,
      'Host: ' + (env.appName || '-') + ' ' + (env.appVersion || '') + ' · CEP ' + ((window.__adobe_cep__ && window.__adobe_cep__.getCurrentApiVersion && JSON.stringify(window.__adobe_cep__.getCurrentApiVersion())) || '-'),
      'Platform: ' + navigator.platform + ' · DPR ' + (window.devicePixelRatio || 1) + ' · ' + window.innerWidth + 'x' + window.innerHeight,
      'UA: ' + navigator.userAgent,
      'Image: ' + (src ? src.origin + ' ' + Math.round(src.width) + 'x' + Math.round(src.height) + ' (' + src.img.naturalWidth + 'x' + src.img.naturalHeight + ' px)' : 'none'),
      'Mode: ' + state.type + ' / ' + state.mode + ' / preset ' + ui.preset,
      'Errors:',
      LOG.length ? LOG.join('\n') : '(none)'
    ].join('\n');
  }

  function setStatus(msg, kind) {
    if (kind === 'err' && msg) logError(msg);
    var s = byId('status');
    clearTimeout(ui.toastTimer);
    s.textContent = msg || '';
    s.className = 'toast ' + (kind || '');
    s.hidden = !msg;
    if (msg) ui.toastTimer = setTimeout(function () { s.hidden = true; }, kind === 'err' ? 9000 : 3500);
  }

  function updateActions() {
    byId('btnCreate').disabled = busy || !result;
    byId('btnSvg').disabled = busy || !result;
  }

  function showBusy(msg) {
    busy = true;
    byId('busy').hidden = false;
    byId('busy').querySelector('span').textContent = msg;
    ['btnSel', 'btnOpen', 'srcCard'].forEach(function (id) { byId(id).disabled = true; });
    updateActions();
  }

  function hideBusy() {
    busy = false;
    byId('busy').hidden = true;
    ['btnSel', 'btnOpen', 'srcCard'].forEach(function (id) { byId(id).disabled = false; });
    updateActions();
  }

  /* --------------------------------------------------------------- about */

  // Links must open in the user's browser: navigating inside a CEP panel would replace the panel.
  function openLink(url) {
    try {
      if (window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser) {
        window.cep.util.openURLInDefaultBrowser(url);
        return;
      }
    } catch (e) { /* fall through to window.open */ }
    window.open(url, '_blank', 'noopener');
  }

  function openAbout() {
    closeMenu();
    byId('aboutVersion').textContent = 'Version ' + VERSION;
    byId('about').hidden = false;
  }

  function closeAbout() {
    byId('about').hidden = true;
  }

  function applyHostTheme() {
    try {
      var skin = JSON.parse(window.__adobe_cep__.getHostEnvironment()).appSkinInfo;
      var c = skin.panelBackgroundColor.color;
      var rgb = [c.red, c.green, c.blue].map(Math.round);
      document.documentElement.style.setProperty('--bg', 'rgb(' + rgb.join(',') + ')');
      document.documentElement.classList.toggle('light', (rgb[0] + rgb[1] + rgb[2]) / 3 > 150);
    } catch (e) { /* keep default dark theme */ }
  }

  function init() {
    if (CEP) {
      document.body.classList.add('cep');
      applyHostTheme();
      window.__adobe_cep__.addEventListener('com.adobe.csxs.events.ThemeColorChanged', applyHostTheme);
    }
    buildTabs();
    buildControls();
    buildPresetTiles();
    bindCompare();
    updateActions();

    byId('srcCard').addEventListener('click', function () {
      if (!CEP) { openImage(); return; }
      if (byId('srcMenu').hidden) openMenu(); else closeMenu();
    });
    byId('btnEmptyPick').addEventListener('click', function (ev) { ev.stopPropagation(); openMenu(); });
    byId('btnEmptyOpen').addEventListener('click', openImage);
    byId('btnSel').addEventListener('click', useSelection);
    byId('btnOpen').addEventListener('click', openImage);
    byId('btnCreate').addEventListener('click', createVector);
    byId('btnSvg').addEventListener('click', exportSVG);
    byId('status').addEventListener('click', function () { this.hidden = true; });
    document.addEventListener('mousedown', function (ev) {
      if (!byId('srcMenu').hidden && !ev.target.closest('.source') && !ev.target.closest('#btnEmptyPick')) closeMenu();
    });
    document.addEventListener('mousedown', function (ev) {
      if (popup.el && !popup.el.contains(ev.target) && !(popup.owner && popup.owner.contains(ev.target))) closePopup();
    });
    // Close on scroll only if the button actually moved (layout changes also fire scroll events).
    byId('scroll').addEventListener('scroll', function () {
      if (popup.el && Math.abs(popup.owner.getBoundingClientRect().top - popup.top) > 2) closePopup();
    });
    window.addEventListener('resize', closePopup);
    document.addEventListener('keydown', function (ev) {
      // Mac: Cmd+C/X/V/A/Z in text fields (Illustrator would otherwise take them).
      if (MAC && ev.metaKey && /^(INPUT|TEXTAREA)$/.test(ev.target.tagName) && ev.target.type !== 'range') {
        var cmd = { c: 'copy', x: 'cut', v: 'paste', a: 'selectAll', z: ev.shiftKey ? 'redo' : 'undo' }[String(ev.key).toLowerCase()];
        if (cmd) { ev.preventDefault(); document.execCommand(cmd); return; }
      }
      if (ev.key !== 'Escape') return;
      if (popup.el) closePopup();
      else if (fontMenu.el && !fontMenu.el.hidden) closeFontMenu();
      else if (!byId('about').hidden) closeAbout();
      else closeMenu();
    });
    byId('btnAbout').addEventListener('click', openAbout);
    byId('btnDiag').addEventListener('click', function () {
      setStatus(copyText(diagnostics()) ? 'Diagnostics copied. Paste them into your message to Bu Khalil Studio.' : 'Could not copy the diagnostics.', 'ok');
    });
    byId('btnAboutClose').addEventListener('click', closeAbout);
    document.querySelectorAll('.about-link').forEach(function (a) {
      a.addEventListener('click', function (ev) { ev.preventDefault(); openLink(a.dataset.url); });
    });

    if (CEP) {
      registerKeys();
      var follow = byId('followSel');
      try { follow.checked = localStorage.getItem('engraver.follow') !== '0'; } catch (e) {}
      follow.addEventListener('change', function () {
        try { localStorage.setItem('engraver.follow', follow.checked ? '1' : '0'); } catch (e) {}
        if (follow.checked) { canvas.lastSel = null; poll(); }   // pick up the current selection right away
      });
      byId('btnRefresh').addEventListener('click', refreshImageList);
      window.__adobe_cep__.addEventListener('documentAfterActivate', function () {
        if (Date.now() < (canvas.ignoreActivateUntil || 0)) return;   // our own temporary preview document
        canvas.listKey = '';
        poll();
      });
      refreshImageList();
      poll();
      setInterval(poll, 900);
    }
    syncFontButton();
    fillStyleOptions();
    if (CEP) setTimeout(loadFonts, 1200);
    byId('fileInput').addEventListener('change', function () {
      var f = this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { loadImage(reader.result, { name: f.name, origin: 'File' }); };
      reader.readAsDataURL(f);
      this.value = '';
    });

    var resizeTimer = 0;
    window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 30); });
  }

  // The Pro edition gets its API before init(): its custom controls are built inside init().
  if (PRO && PRO.init) {
    PRO.api = {
      E: E, CEP: CEP, CEP_FS: CEP_FS, MAC: MAC, VERSION: VERSION, PARAMS: PARAMS, PRESETS: PRESETS, P: P, DEFAULTS: DEFAULTS,
      ui: ui, state: function () { return state; }, setState: function (st) { state = st; }, src: function () { return src; },
      result: function () { return result; }, set: set, schedule: schedule, regenerate: regenerate, draw: draw, composite: composite,
      el: el, byId: byId, makeDropdown: makeDropdown, makeColor: makeColor, openPopup: openPopup, closePopup: closePopup,
      colorPanel: colorPanel, popup: popup, SWATCHES: SWATCHES, KEEP_KEYS: KEEP_KEYS,
      hexToRgb: hexToRgb, rgbToHex: rgbToHex, applyPreset: applyPreset, buildPresetTiles: buildPresetTiles,
      renderThumbs: renderThumbs, syncControls: syncControls, syncVisibility: syncVisibility, setStatus: setStatus,
      thumbPixels: thumbPixels, paints: paints, grid: grid, copyText: copyText, jsx: jsx, logError: logError,
      formatValue: formatValue, stepValue: stepValue, WORK_RES: WORK_RES, THUMB_RES: THUMB_RES, ICON: ICON,
      sanitize: sanitizeOpts, cleanType: cleanType, EXTRA_KEYS: EXTRA_KEYS, compute: compute, hostData: hostData,
      loadImage: loadImage, localURL: localURL, decode: decode, canvasState: function () { return canvas; },
      refreshImageList: refreshImageList, showBusy: showBusy, hideBusy: hideBusy, updateActions: updateActions,
      textLayout: textLayout, fonts: function () { return fonts; }, setResult: function (r) { result = r; },
      build: buildResult, outputResult: outputResult, createVector: createVector, loadCapture: loadCapture, previewQ: previewQ,
      setType: setType, busy: function () { return busy; }
    };
  }

  init();
  if (PRO && PRO.init) PRO.init(PRO.api);

  // Test/automation hook.
  window.AZMEEL_VERSION = VERSION;     // read by js/update.js

  window.EngraverPanel = {
    loadURL: function (url, name) { loadImage(url, { name: name || url, origin: 'File' }); },
    preset: applyPreset,
    setType: setType,
    set: set,
    poll: poll,
    create: createVector,
    hostData: function (place) { return hostData(result, place || { left: 0, top: 0, scale: 1 }, false); },
    openMenu: openMenu,
    openAbout: openAbout,
    setFont: setFontFamily,
    openFontMenu: function (filter, query) {
      toggleFontMenu(P.fontFamily.input);
      if (filter) fontMenu.el.querySelector('[data-f="' + filter + '"]').click();
      if (query) { fontMenu.search.value = query; fontMenu.query = query; renderFontMenu(); }
    },
    version: VERSION,
    compare: function (on, split) { ui.compare = on; ui.split = split == null ? 0.5 : split; byId('btnCompare').classList.toggle('on', on); draw(); },
    status: setStatus,
    state: function () { return state; },
    result: function () { return result; }
  };
})();
