/*
 * Azmeel by Bu Khalil Studio - Illustrator side (ExtendScript, ES3).
 * Copyright (c) 2026 Bu Khalil Studio (Ibrahim Khalil). All rights reserved.
 * Every public function returns a JSON string: {"ok":true,...} or {"ok":false,"error":"..."}.
 */

function engraver__json(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v, i, a;
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return String(v);
    if (t === 'string') {
        // Control characters are invalid raw inside JSON strings: the font list uses U+0001/U+0002
        // as separators, and some installed fonts even carry control characters in their names.
        // (split/join is ~300x faster than a U+0001 regex on the 600 KB font list in ExtendScript;
        // a literal U+0000 in a regex is a syntax error there, hence the RegExp from a string.)
        var s = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
            .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
            .split(String.fromCharCode(1)).join('\\u0001').split(String.fromCharCode(2)).join('\\u0002');
        var ctrl = new RegExp('[\\x00-\\x1f]', 'g');
        if (ctrl.test(s)) {
            ctrl.lastIndex = 0;
            s = s.replace(ctrl, function (c) { return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4); });
        }
        return '"' + s + '"';
    }
    if (v instanceof Array) {
        a = [];
        for (i = 0; i < v.length; i++) a.push(engraver__json(v[i]));
        return '[' + a.join(',') + ']';
    }
    a = [];
    for (i in v) if (v.hasOwnProperty(i)) a.push(engraver__json(i) + ':' + engraver__json(v[i]));
    return '{' + a.join(',') + '}';
}

function engraver__ok(o) { o = o || {}; o.ok = true; return engraver__json(o); }
function engraver__fail(msg) { return engraver__json({ ok: false, error: String(msg) }); }
function engraver__err(e) { return engraver__fail(e.message + (e.line ? ' (line ' + e.line + ')' : '')); }

function engraver__unionBounds(items) {
    var b = items[0].geometricBounds, u = [b[0], b[1], b[2], b[3]];
    for (var i = 1; i < items.length; i++) {
        b = items[i].geometricBounds;
        if (b[0] < u[0]) u[0] = b[0];
        if (b[1] > u[1]) u[1] = b[1];
        if (b[2] > u[2]) u[2] = b[2];
        if (b[3] < u[3]) u[3] = b[3];
    }
    return u;
}

// The items last captured with "Use selection", if they still exist in the active document.
function engraver__source() {
    try {
        var s = $.global.__azmeelSource;
        if (!s || app.documents.length === 0) return null;
        if (app.activeDocument.name !== s.docName) return null;
        for (var i = 0; i < s.items.length; i++) s.items[i].geometricBounds; // throws if deleted
        return s.items;
    } catch (e) {
        return null;
    }
}

function engraver_tempFolder() {
    return engraver__ok({ path: Folder.temp.fsName.replace(/\\/g, '/') });
}

function engraver__isImage(it) {
    return it.typename === 'PlacedItem' || it.typename === 'RasterItem';
}

function engraver__hidden(it) {
    try {
        if (it.hidden) return true;
        var p = it.parent;
        while (p && p.typename !== 'Document') {
            if (p.typename === 'Layer' && !p.visible) return true;
            if (p.typename === 'GroupItem' && p.hidden) return true;
            p = p.parent;
        }
    } catch (e) {}
    return false;
}

// A linked JPG/PNG that is shown as-is (no rotation, flip or clipping mask) can be
// read straight from disk: faster, full resolution, and no temporary document.
function engraver__directFile(it) {
    if (it.typename !== 'PlacedItem') return null;
    try {
        var f = it.file;
        if (!f || !f.exists || !/\.(png|jpe?g|gif|bmp|webp)$/i.test(f.name)) return null;
        var m = it.matrix;
        if (Math.abs(m.mValueB) > 1e-4 || Math.abs(m.mValueC) > 1e-4) return null;
        if (m.mValueA <= 0 || m.mValueD >= 0) return null;   // unflipped placed art has d < 0
        for (var p = it.parent; p && p.typename === 'GroupItem'; p = p.parent) if (p.clipped) return null;
        return f;
    } catch (e) {
        return null;
    }
}

// Identity of the current selection. Uses item uuids, so moving or scaling the
// selected image does not look like a new selection (that used to trigger a re-capture).
function engraver__selSig(doc) {
    var sel = doc.selection, sig = '', img = false;
    if (sel && sel instanceof Array && sel.length) {
        img = true;
        for (var i = 0; i < sel.length && i < 50; i++) {
            var id;
            try { id = sel[i].uuid; } catch (e) { id = null; }
            if (!id) {
                var b = sel[i].geometricBounds;
                id = Math.round(b[0]) + ',' + Math.round(b[1]) + ',' + Math.round(b[2]) + ',' + Math.round(b[3]);
            }
            sig += sel[i].typename + ':' + id + ';';
            if (!engraver__isImage(sel[i])) img = false;
        }
        sig = doc.name + '|' + sel.length + '|' + sig;
    }
    return { sig: sig, img: img };
}

// Cheap snapshot for the panel's polling: which document, how many images, what is selected.
function engraver_poll() {
    try {
        if (app.documents.length === 0) return engraver__ok({ doc: '', images: 0, sel: '', selIsImage: false });
        var doc = app.activeDocument, s = engraver__selSig(doc);
        return engraver__ok({
            doc: doc.name,
            images: doc.placedItems.length + doc.rasterItems.length,
            sel: s.sig,
            selIsImage: s.img
        });
    } catch (e) {
        return engraver__err(e);
    }
}

// Every image in the active document, for the panel's "Images on canvas" list.
function engraver_listImages() {
    try {
        if (app.documents.length === 0) return engraver__ok({ doc: '', items: [] });
        var doc = app.activeDocument, out = [];
        function add(col, kind) {
            for (var i = 0; i < col.length; i++) {
                var it = col[i], b = it.geometricBounds, name = it.name, linked = '';
                if (kind === 'placed') {
                    try { linked = decodeURI(it.file.name); } catch (e) { linked = ''; }
                }
                out.push({
                    kind: kind, index: i,
                    name: name || linked || (kind === 'placed' ? 'Linked image ' : 'Embedded image ') + (i + 1),
                    w: Math.round(b[2] - b[0]), h: Math.round(b[1] - b[3]),
                    hidden: engraver__hidden(it), selected: it.selected,
                    linked: linked
                });
            }
        }
        add(doc.placedItems, 'placed');
        add(doc.rasterItems, 'raster');
        return engraver__ok({ doc: doc.name, items: out });
    } catch (e) {
        return engraver__err(e);
    }
}

// Load one image from the list: select it on the canvas (when possible) and capture it.
// forceExport: skip reading the linked file directly (the panel asks for this when the
// file's pixels don't match what Illustrator shows, e.g. EXIF-rotated JPEGs).
function engraver_captureImage(kind, index, forceExport) {
    try {
        if (app.documents.length === 0) return engraver__fail('No open document.');
        var doc = app.activeDocument;
        var col = kind === 'raster' ? doc.rasterItems : doc.placedItems;
        if (index >= col.length) return engraver__fail('That image is no longer in the document. Refresh the list.');
        var it = col[index];
        try {
            if (!engraver__hidden(it) && !it.locked) { doc.selection = null; it.selected = true; }
        } catch (ignore) {}
        return engraver__capture(doc, [it], forceExport);
    } catch (e) {
        return engraver__err(e);
    }
}

// Capture the current selection.
function engraver_exportSelection(forceExport) {
    try {
        if (app.documents.length === 0) return engraver__fail('Open a document and select an image first.');
        var doc = app.activeDocument, sel = doc.selection;
        if (!sel || !(sel instanceof Array) || sel.length === 0) {
            return engraver__fail('Select an image (or any artwork) on the artboard first.');
        }
        var items = [];
        for (var i = 0; i < sel.length; i++) items.push(sel[i]);
        return engraver__capture(doc, items, forceExport);
    } catch (e) {
        return engraver__err(e);
    }
}

// Get pixels for `items`: the linked file itself when possible, otherwise a temp PNG export.
// The result carries the selection signature so the panel doesn't re-capture the same thing.
// A temporary top layer in the user's document (no new window). Removed by engraver__dropLayer.
function engraver__tempLayer(doc) {
    var L = doc.layers.add();
    L.name = '__azmeel_temp_' + new Date().getTime();
    return L;
}

function engraver__dropLayer(L) {
    if (L) try { L.remove(); } catch (ignore) {}
}

// Render the items to a PNG without opening a document window: copies go on a temporary
// top layer, the other layers are hidden for a moment, and Document.imageCapture renders
// just that area. Illustrator does not redraw while a script runs, so nothing flickers.
// Everything is put back afterwards; returns false on any failure so the caller can fall back.
function engraver__captureInPlace(doc, items, file, scale) {
    var tmp = null, hidden = [], ok = false;
    try {
        tmp = engraver__tempLayer(doc);
        for (var i = 0; i < items.length; i++) {
            var dup = items[i].duplicate(tmp, ElementPlacement.PLACEATEND);
            if (dup.hidden) dup.hidden = false;
        }
        for (var l = 0; l < doc.layers.length; l++) {
            var L = doc.layers[l];
            if (L.name === tmp.name || !L.visible) continue;
            L.visible = false;
            hidden.push(L);
        }
        var opt = new ImageCaptureOptions();
        opt.resolution = Math.max(72, 72 * scale / 100);          // imageCapture refuses less than 72 dpi
        opt.antiAliasing = true;
        opt.transparency = false;
        opt.matte = true;
        var white = new RGBColor();
        white.red = white.green = white.blue = 255;
        opt.matteColor = white;
        doc.imageCapture(file, engraver__unionBounds(tmp.pageItems), opt);
        ok = file.exists;
    } catch (e) {
        ok = false;
    } finally {
        for (var h = 0; h < hidden.length; h++) try { hidden[h].visible = true; } catch (ignore) {}
        engraver__dropLayer(tmp);
    }
    return ok;
}

function engraver__capture(doc, items, forceExport) {
    try {
        var i, b = engraver__unionBounds(items), w = b[2] - b[0], h = b[1] - b[3];
        if (w < 2 || h < 2) return engraver__fail('The selection is too small.');

        var direct = items.length === 1 && !forceExport ? engraver__directFile(items[0]) : null;
        if (direct) {
            $.global.__azmeelSource = { docName: doc.name, items: items };
            return engraver__ok({
                path: direct.fsName.replace(/\\/g, '/'), direct: true,
                width: w, height: h,
                name: items[0].name || decodeURI(direct.name),
                sel: engraver__selSig(doc).sig
            });
        }

        // Documents are limited to 16383 pt; very large artwork is scaled down inside the temp doc.
        var fit = Math.min(1, 8000 / Math.max(w, h));
        // 1800px long side: enough for crisp logo edges (the panel downsamples photos).
        var scale = Math.max(10, Math.min(776, 1800 / (Math.max(w, h) * fit) * 100));
        var file = new File(Folder.temp.fsName + '/azmeel_src_' + new Date().getTime() + '.png');

        // Preferred: capture inside the open document (no temporary window).
        var ipScale = Math.max(10, Math.min(776, 1800 / Math.max(w, h) * 100));
        // Up to 6000 pt (at >= 72 dpi that stays a reasonable bitmap); larger art uses the fallback.
        if (Math.max(w, h) <= 6000 && engraver__captureInPlace(doc, items, file, ipScale)) {
            $.global.__azmeelSource = { docName: doc.name, items: items };
            var ipName = items.length === 1 && items[0].name ? items[0].name : items[0].typename;
            return engraver__ok({
                path: file.fsName.replace(/\\/g, '/'),
                width: w, height: h,
                name: ipName + (items.length > 1 ? ' +' + (items.length - 1) : ''),
                sel: engraver__selSig(doc).sig
            });
        }

        // Fallback: a temporary document.
        var tmp = app.documents.add(DocumentColorSpace.RGB, Math.max(2, w * fit), Math.max(2, h * fit));
        try {
            var grp = tmp.layers[0].groupItems.add();
            for (i = 0; i < items.length; i++) {
                // Cross-document duplicate only accepts a layer/document target.
                var dup = items[i].duplicate(tmp.layers[0], ElementPlacement.PLACEATEND);
                if (dup.hidden) dup.hidden = false;
                dup.move(grp, ElementPlacement.PLACEATEND);
            }
            if (fit < 1) grp.resize(fit * 100, fit * 100, true, true, true, true, fit * 100, Transformation.TOPLEFT);
            var ab = tmp.artboards[0].artboardRect, gb = grp.geometricBounds;
            grp.translate(ab[0] - gb[0], ab[1] - gb[1]);
            tmp.artboards[0].artboardRect = grp.geometricBounds;

            var opt = new ExportOptionsPNG24();
            opt.antiAliasing = true;
            opt.transparency = false;
            opt.artBoardClipping = true;
            opt.horizontalScale = scale;
            opt.verticalScale = scale;
            tmp.exportFile(file, ExportType.PNG24, opt);
        } finally {
            tmp.close(SaveOptions.DONOTSAVECHANGES);
            doc.activate();
        }

        if (!file.exists) return engraver__fail('Illustrator could not export the selection.');

        $.global.__azmeelSource = { docName: doc.name, items: items };
        var name = items.length === 1 && items[0].name ? items[0].name : items[0].typename;
        return engraver__ok({
            path: file.fsName.replace(/\\/g, '/'),
            width: w, height: h,
            name: name + (items.length > 1 ? ' +' + (items.length - 1) : ''),
            sel: engraver__selSig(doc).sig
        });
    } catch (e) {
        return engraver__err(e);
    }
}

// Where the engraving goes: over the captured source, or fitted into the active artboard.
function engraver_placement(w, h, useSource) {
    try {
        var src = useSource ? engraver__source() : null;
        if (src) {
            var b = engraver__unionBounds(src);
            return engraver__ok({ left: b[0], top: b[1], scale: (b[2] - b[0]) / w, fromSource: true });
        }
        var doc = app.documents.length ? app.activeDocument : app.documents.add(DocumentColorSpace.RGB, w, h);
        var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
        var abW = ab[2] - ab[0], abH = ab[1] - ab[3];
        var s = Math.min(abW / w, abH / h);
        return engraver__ok({
            left: ab[0] + (abW - w * s) / 2,
            top: ab[1] - (abH - h * s) / 2,
            scale: s,
            fromSource: false
        });
    } catch (e) {
        return engraver__err(e);
    }
}

// k (0..100, or -1): the panel sends it when the colour is a black/white mix, so CMYK
// documents get pure K instead of a four-colour rich black / grey.
function engraver__color(doc, hex, k) {
    var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    var c;
    if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
        if (k === undefined || k < 0) k = (r === 0 && g === 0 && b === 0) ? 100 : -1;
        if (k >= 0) {
            c = new CMYKColor();
            c.cyan = 0; c.magenta = 0; c.yellow = 0; c.black = k;
            return c;
        }
    }
    c = new RGBColor();
    c.red = r; c.green = g; c.blue = b;
    return c;
}

// Installed fonts grouped by family: {families: {"Arial": [["Regular","ArialMT"], ["Bold","Arial-BoldMT"]], ...}}
// Returned as one delimited string (family U+0001 style U+0001 PostScript name, records split by
// U+0002): serialising ~10k small objects with engraver__json takes ~25 s in ExtendScript.
function engraver_fonts() {
    try {
        var rows = [], fonts = app.textFonts, n = fonts.length;
        var SEP1 = String.fromCharCode(1), SEP2 = String.fromCharCode(2);
        for (var i = 0; i < n; i++) {
            var f = fonts[i];
            if (f.family) rows.push(f.family + SEP1 + f.style + SEP1 + f.name);
        }
        var fams = rows.join(SEP2);
        // Creative Cloud's list of activated Adobe Fonts (lets the panel label them).
        // Folder.userData is AppData\Roaming on Windows and ~/Library/Application Support on macOS.
        var adobeFile = '';
        try { adobeFile = Folder.userData.fsName.replace(/\\/g, '/') + '/Adobe/CoreSync/plugins/livetype/c/entitlements.xml'; } catch (e) {}
        return engraver__ok({ list: fams, count: n, adobeFile: adobeFile });
    } catch (e) {
        return engraver__err(e);
    }
}

// Exact outlines of the brand text, straight from Illustrator's font engine, for the panel preview.
// Needed for fonts the panel's browser engine can't draw (e.g. Adobe Fonts activated for Adobe apps only).
// req: {font, items: [{s, top, r, size, tracking}]}, geometry relative to the badge centre.
// Returns paths as flat arrays [closed, ax, ay, lx, ly, rx, ry, ...] with y pointing up.
function engraver_textPreview(reqJSON) {
    var userDoc = app.documents.length ? app.activeDocument : null, tmp = null;
    try {
        var req = eval('(' + reqJSON + ')');
        var spec = { cx: 0, cy: 0, font: req.font, color: '#000000', k: -1, outline: true, items: req.items };
        var paths = [];
        if (userDoc) {
            // In the open document on a temporary layer: no window opens and closes.
            var L = null;
            try {
                L = engraver__tempLayer(userDoc);
                engraver__brandText(userDoc, L, spec);
                engraver__collectPaths(L, paths);
                return engraver__ok({ paths: paths });
            } catch (e1) {
                paths = [];                                   // fall back to a temporary document below
            } finally {
                engraver__dropLayer(L);
            }
        }
        tmp = app.documents.add(DocumentColorSpace.RGB, 100, 100);
        engraver__brandText(tmp, tmp.layers[0], spec);
        engraver__collectPaths(tmp.layers[0], paths);
        return engraver__ok({ paths: paths });
    } catch (e) {
        return engraver__err(e);
    } finally {
        if (tmp) try { tmp.close(SaveOptions.DONOTSAVECHANGES); } catch (ignore) {}
        if (userDoc) try { userDoc.activate(); } catch (ignore) {}
    }
}

function engraver__collectPaths(container, out) {
    var items = container.pageItems, i, j;
    for (i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.typename === 'GroupItem') engraver__collectPaths(it, out);
        else if (it.typename === 'CompoundPathItem') {
            for (j = 0; j < it.pathItems.length; j++) out.push(engraver__pathData(it.pathItems[j]));
        } else if (it.typename === 'PathItem') out.push(engraver__pathData(it));
    }
}

function engraver__pathData(p) {
    var pts = p.pathPoints, a = [p.closed ? 1 : 0];
    function r(v) { return Math.round(v * 100) / 100; }
    for (var i = 0; i < pts.length; i++) {
        var q = pts[i];
        a.push(r(q.anchor[0]), r(q.anchor[1]), r(q.leftDirection[0]), r(q.leftDirection[1]), r(q.rightDirection[0]), r(q.rightDirection[1]));
    }
    return a;
}

// Open half-circle (Bezier) from left to right, over the top or under the bottom.
// Text placed on it reads left to right: outward on top, upright (toward the centre) at the bottom.
function engraver__arc(container, cx, cy, r, top) {
    var s = top ? 1 : -1, k = 0.5522847 * r;
    var p = container.pathItems.add();
    p.setEntirePath([[cx - r, cy], [cx, cy + s * r], [cx + r, cy]]);
    var pp = p.pathPoints;
    pp[0].leftDirection = [cx - r, cy];          pp[0].rightDirection = [cx - r, cy + s * k];
    pp[1].leftDirection = [cx - k, cy + s * r];  pp[1].rightDirection = [cx + k, cy + s * r];
    pp[2].leftDirection = [cx + r, cy + s * k];  pp[2].rightDirection = [cx + r, cy];
    return p;
}

// Hebrew/Arabic range, built from char codes so this file stays pure ASCII (ExtendScript may not read it as UTF-8).
function engraver__isRTL(str) {
    for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        if (c >= 0x0590 && c <= 0x08FF) return true;
    }
    return false;
}

// text: {cx, cy, font, tracking, color, k, outline, items: [{s, top, r, size, tracking}]} (document coordinates)
function engraver__brandText(doc, layer, text) {
    var g = layer.groupItems.add();
    g.name = 'Brand text';
    var color = engraver__color(doc, text.color, text.k), font = null, made = 0;
    try { if (text.font) font = app.textFonts.getByName(text.font); } catch (e) { font = null; }
    for (var i = 0; i < text.items.length; i++) {
        var it = text.items[i];
        var tf = g.textFrames.pathText(engraver__arc(g, text.cx, text.cy, it.r, it.top));
        tf.contents = it.s;
        // Read tf.textRange afresh for every attribute: a TextRange kept in a variable goes
        // stale once another range is requested ("illegal text range").
        if (font) tf.textRange.characterAttributes.textFont = font;
        tf.textRange.characterAttributes.size = it.size;
        tf.textRange.characterAttributes.tracking = it.tracking !== undefined ? it.tracking : (text.tracking || 0);
        tf.textRange.characterAttributes.fillColor = color;
        tf.textRange.paragraphAttributes.justification = Justification.CENTER;
        if (engraver__isRTL(it.s)) {
            try { tf.textRange.paragraphAttributes.paragraphDirection = ParagraphDirectionType.RIGHT_TO_LEFT_DIRECTION; } catch (e) {}
        }
        // Illustrator's font metrics differ slightly from the panel's: shrink until nothing is cut off.
        var size = it.size;
        for (var guard = 0; guard < 25; guard++) {
            var shown = 0;
            for (var l = 0; l < tf.lines.length; l++) shown += tf.lines[l].characters.length;
            if (shown >= tf.characters.length) break;
            size *= 0.95;
            tf.textRange.characterAttributes.size = size;
        }
        var label = it.top ? 'Top text' : 'Bottom text';
        if (text.outline) tf.createOutline().name = label;
        else tf.name = label;
        made++;
    }
    return made;
}

// A global process swatch per colour ("Azmeel #rrggbb"), so the whole artwork can be
// recoloured from the Swatches panel. Reused when it already exists.
function engraver__swatch(doc, hex, k) {
    var name = 'Azmeel ' + hex.toUpperCase(), sp;
    try { sp = doc.spots.getByName(name); } catch (e) { sp = null; }
    if (!sp) {
        sp = doc.spots.add();
        sp.name = name;
        sp.color = engraver__color(doc, hex, k);
        sp.colorType = ColorModel.PROCESS;
    }
    var c = new SpotColor();
    c.spot = sp;
    c.tint = 100;
    return c;
}

// GradientColor from {type, x1, y1, x2, y2 | cx, cy, r, stops: [[t, hex], ...]} in document coordinates.
function engraver__gradient(doc, g) {
    var gr = doc.gradients.add();
    gr.type = g.type === 'radial' ? GradientType.RADIAL : GradientType.LINEAR;
    var stops = g.stops;
    // a new gradient has two stops; add the rest, then set them all
    while (gr.gradientStops.length < stops.length) gr.gradientStops.add();
    for (var i = 0; i < stops.length; i++) {
        var st = gr.gradientStops[i];
        st.rampPoint = Math.max(0, Math.min(100, stops[i][0] * 100));
        st.midPoint = 50;
        st.color = engraver__color(doc, stops[i][1]);
    }
    var gc = new GradientColor();
    gc.gradient = gr;
    if (g.type === 'radial') {
        gc.origin = [g.cx, g.cy];
        gc.length = g.r;
    } else {
        gc.origin = [g.x1, g.y1];
        gc.length = Math.sqrt((g.x2 - g.x1) * (g.x2 - g.x1) + (g.y2 - g.y1) * (g.y2 - g.y1));
        gc.angle = Math.atan2(g.y2 - g.y1, g.x2 - g.x1) * 180 / Math.PI;
    }
    return gc;
}

// Illustrator ignores GradientColor.angle when a gradient is assigned; turn the gradient itself
// (fill only, not the shape) to match the requested direction.
function engraver__aimGradient(item, g) {
    if (!g || g.type === 'radial') return;
    var a = Math.atan2(g.y2 - g.y1, g.x2 - g.x1) * 180 / Math.PI;
    if (Math.abs(a) < 0.01) return;
    try { item.rotate(a, false, false, true, false, Transformation.CENTER); } catch (e) {}
}

function engraver__blend(name) {
    var m = { multiply: BlendModes.MULTIPLY, screen: BlendModes.SCREEN, overlay: BlendModes.OVERLAY, darken: BlendModes.DARKEN,
              lighten: BlendModes.LIGHTEN, 'color-burn': BlendModes.COLORBURN, difference: BlendModes.DIFFERENCE };
    return m[name] || BlendModes.NORMAL;
}

// Letters (Type fill): one outlined prototype per character at 100 pt, then a scaled copy per
// glyph with its ink box centred on (x, y) - the same centring the panel preview uses.
function engraver__glyphs(doc, g, L, color) {
    var d = engraver__nums(L.glyphs), rot = L.grot ? engraver__nums(L.grot) : null, protos = {}, count = 0, font = null;
    try { font = app.textFonts.getByName(L.font); } catch (e) { font = null; }
    function proto(ci) {
        if (protos[ci]) return protos[ci];
        var tf = g.textFrames.add();
        tf.contents = L.chars[ci];
        tf.textRange.characterAttributes.size = 100;
        if (font) tf.textRange.characterAttributes.textFont = font;
        tf.textRange.characterAttributes.fillColor = color;
        var og = tf.createOutline(), b = og.geometricBounds;
        // Scaling and rotating about the centre keep the centre in place, so each copy is moved by a
        // known offset (no bounds read per letter).
        protos[ci] = { item: og, ok: b[2] - b[0] > 0.01, cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2 };
        return protos[ci];
    }
    for (var i = 0; i + 3 < d.length; i += 4) {
        var p = proto(d[i + 3]);
        if (!p.ok) continue;
        var dup = p.item.duplicate(g, ElementPlacement.PLACEATEND), s = d[i + 2];
        dup.resize(s, s, true, true, true, true, s, Transformation.CENTER);
        if (rot && rot[i / 4]) dup.rotate(rot[i / 4], true, true, true, true, Transformation.CENTER);
        dup.translate(d[i] - p.cx, d[i + 1] - p.cy);
        count++;
    }
    for (var k in protos) if (protos.hasOwnProperty(k)) try { protos[k].item.remove(); } catch (e2) {}
    return count;
}

function engraver__fill(p, color) {
    p.stroked = false;
    p.filled = true;
    p.fillColor = color;
}

// Build the paths. dataPath points at a file written by the panel containing
// ({color, hideSource, layers:[{name, polys:[[[x,y],...], ...]}]}) in document coordinates.
function engraver_build(dataPath) {
    try {
        var f = new File(dataPath);
        if (!f.exists) return engraver__fail('Engraving data file not found.');
        f.encoding = 'UTF-8';
        f.open('r');
        var text = f.read();
        f.close();
        try { f.remove(); } catch (ignore) {}
        return engraver__buildText(text);
    } catch (e) {
        return engraver__err(e);
    }
}

// Fallback transport when the panel has no file API: data arrives in pieces.
function engraver_chunkReset() { $.global.__azmeelChunks = []; return engraver__ok(); }
function engraver_chunk(s) { $.global.__azmeelChunks.push(s); return engraver__ok(); }
function engraver_buildChunks() {
    var text = ($.global.__azmeelChunks || []).join('');
    $.global.__azmeelChunks = [];
    return engraver__buildText(text);
}

// Numbers arrive as one comma-separated string ("x,y,r,x,y,r..."), polygons as such strings
// joined by ";". Arrays that come out of eval'ing a big literal are extremely slow to read in
// ExtendScript (110k numbers: 16 s); split() arrays are fast (60 ms). Plain arrays still work.
function engraver__nums(v) {
    if (typeof v !== 'string') return v || [];
    if (!v.length) return [];
    var a = v.split(',');
    for (var i = 0; i < a.length; i++) a[i] = +a[i];
    return a;
}

// Polygons stay strings ("x,y,x,y...") until each one is built: ExtendScript slows down badly when tens of
// thousands of small [x, y] arrays are alive at once (1,895 hearts: 34 s to parse all first, under 1 s this way).
function engraver__polys(v) {
    if (typeof v !== 'string') return v || [];
    if (!v.length) return [];
    return v.split(';');
}

// Illustrator limits (measured on 30.8, 2026-10): setEntirePath accepts at most 1000 points per call
// (1001 throws "Illegal Argument"), and one path holds at most 32000 points ("cannot insert more
// segments in path").
var ENGRAVER_MAX_SET = 1000;
var ENGRAVER_MAX_POINTS = 30000;

// Add one path to `items` (a pathItems collection), whatever its size. Long shapes - big merged
// Dither/Stitch areas, long contours - get their first 1000 points in one call and the rest one by one.
// Shapes over the per-path maximum are thinned just enough to fit (counted in `bad.thinned`).
// If Illustrator still rejects a shape, it is retried with smaller calls and finally point by point,
// leaving out only the points it refuses; only a shape that cannot even start is recorded in `bad`.
// Coordinates stay one flat number list until they are handed over: tens of thousands of live
// [x, y] arrays make ExtendScript crawl.
function engraver__addPath(items, q, bad) {
    var f = engraver__flat(q);
    if (!f.length) return null;
    if (f.length > 2 * ENGRAVER_MAX_POINTS) {
        f = engraver__thin(f, ENGRAVER_MAX_POINTS);
        bad.thinned = (bad.thinned || 0) + 1;
    }
    var sizes = [ENGRAVER_MAX_SET, 100, 1], err;
    for (var s = 0; s < sizes.length; s++) {
        var p = items.add();
        try {
            engraver__setPath(p, f, sizes[s], s === sizes.length - 1);
            return p;
        } catch (e) {
            err = e;
            try { p.remove(); } catch (ignore) {}
        }
    }
    bad.count++;
    if (!bad.first) bad.first = f.length / 2 + ' points, first at ' + f[0] + ',' + f[1] + ' - ' + err;
    return null;
}

// "x,y,x,y..." (or [[x, y], ...]) as a flat list of numbers, without points that aren't finite.
function engraver__flat(q) {
    var f = [], a, i, x, y;
    if (typeof q === 'string') {
        a = q.split(',');
        for (i = 0; i + 1 < a.length; i += 2) {
            x = +a[i]; y = +a[i + 1];
            if (isFinite(x) && isFinite(y)) f.push(x, y);
        }
    } else if (q) {
        for (i = 0; i < q.length; i++) {
            if (!q[i]) continue;
            x = +q[i][0]; y = +q[i][1];
            if (isFinite(x) && isFinite(y)) f.push(x, y);
        }
    }
    return f;
}

// The first `first` points in one setEntirePath call, the rest one by one. `lenient` skips single
// points Illustrator refuses instead of giving up on the shape.
function engraver__setPath(p, f, first, lenient) {
    var n = f.length / 2, head = [], i, a, pp;
    for (i = 0; i < Math.min(first, n); i++) head.push([f[2 * i], f[2 * i + 1]]);
    p.setEntirePath(head);
    for (i = head.length; i < n; i++) {
        pp = null;
        try {
            a = [f[2 * i], f[2 * i + 1]];
            pp = p.pathPoints.add();
            pp.anchor = a;
            pp.leftDirection = a;
            pp.rightDirection = a;
            pp.pointType = PointType.CORNER;
        } catch (e) {
            if (!lenient) throw e;
            if (pp) try { pp.remove(); } catch (ignore) {}
        }
    }
}

// Fit a flat point list into `max` points in two passes (ExtendScript is slow, so no iterating):
// drop points in the middle of straight runs (exact), then, if still too many, keep `max` evenly spaced
// ones (always the first and last).
function engraver__thin(f, max) {
    var n = f.length / 2, base = [f[0], f[1]], i, ax, ay, bx, by, cx, cy;
    for (i = 1; i < n - 1; i++) {
        ax = base[base.length - 2]; ay = base[base.length - 1];
        bx = f[2 * i]; by = f[2 * i + 1]; cx = f[2 * i + 2]; cy = f[2 * i + 3];
        var cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
        var dot = (bx - ax) * (cx - bx) + (by - ay) * (cy - by);
        if (Math.abs(cross) > 1e-9 || dot <= 0) base.push(bx, by);
    }
    base.push(f[2 * n - 2], f[2 * n - 1]);
    var m = base.length / 2;
    if (m <= max) return base;
    var step = (m - 1) / (max - 1), out = [];
    for (i = 0; i < max; i++) {
        var j = Math.round(i * step);
        out.push(base[2 * j], base[2 * j + 1]);
    }
    return out;
}

// Ink name for a separation layer: Pro sends `ink` per layer (e.g. "PINK"); otherwise the colour itself.
function engraver__inkName(L, data) {
    var n = L.ink || (L.color || data.color || '#000000').toUpperCase().replace('#', '');
    return String(n).replace(/[^A-Za-z0-9 _-]/g, '').toUpperCase() || 'INK';
}

// Colour for a layer. Global process swatches (Pro option) or spot inks (separation option) when asked.
function engraver__layerColor(doc, L, data, pro) {
    var lc = L.color ? engraver__color(doc, L.color, L.k) : engraver__color(doc, data.color);
    if (L.cmyk) {
        // Process separations (CMYK newspaper): exact ink values, whatever the document mode.
        lc = new CMYKColor();
        lc.cyan = L.cmyk[0]; lc.magenta = L.cmyk[1]; lc.yellow = L.cmyk[2]; lc.black = L.cmyk[3];
        if (pro && pro.spot) return engraver__spotInk(doc, engraver__inkName(L, data), L.color || data.color, L.k);
        return lc;
    }
    if (pro && pro.spot) return engraver__spotInk(doc, engraver__inkName(L, data), L.color || data.color, L.k);
    if (data.swatches && !L.gradient) lc = engraver__swatch(doc, L.color || data.color, L.k);
    return lc;
}

// A spot colour per ink ("AZMEEL PINK"), reused when it already exists.
function engraver__spotInk(doc, ink, hex, k) {
    var name = 'AZMEEL ' + ink, sp;
    try { sp = doc.spots.getByName(name); } catch (e) { sp = null; }
    if (!sp) {
        sp = doc.spots.add();
        sp.name = name;
        sp.color = engraver__color(doc, hex, k);
        sp.colorType = ColorModel.SPOT;
    }
    var c = new SpotColor();
    c.spot = sp;
    c.tint = 100;
    return c;
}

// The selected object as a particle shape. Its outline (curves flattened) goes to the panel for the
// preview; the object itself is remembered and copied (or turned into a symbol) when building.
function engraver_particleShape() {
    try {
        if (app.documents.length === 0) return engraver__fail('Open a document and select a vector object first.');
        var doc = app.activeDocument, sel = doc.selection;
        if (!sel || !(sel instanceof Array) || sel.length !== 1) return engraver__fail('Select exactly one vector object (a path, compound path, group or text) to use as the particle.');
        var it = sel[0], t = it.typename;
        if (t !== 'PathItem' && t !== 'CompoundPathItem' && t !== 'GroupItem' && t !== 'TextFrame' && t !== 'SymbolItem') {
            return engraver__fail('That object cannot be used as a particle (' + t + '). Select a path, compound path, group, symbol or text.');
        }
        var polys = [], tmp = null;
        try {
            tmp = engraver__tempLayer(doc);
            var dup = it.duplicate(tmp, ElementPlacement.PLACEATEND);
            if (dup.typename === 'TextFrame') dup = dup.createOutline();
            if (dup.typename === 'SymbolItem') dup.breakLink();
            engraver__flatten(tmp, polys);
        } finally {
            engraver__dropLayer(tmp);
        }
        if (!polys.length) return engraver__fail('That object has no closed shapes to use as a particle.');
        var b = it.geometricBounds;
        $.global.__azmeelParticle = { docName: doc.name, item: it, w: b[2] - b[0], h: b[1] - b[3], symbol: null };
        var name = it.name || (t === 'TextFrame' ? 'Text' : t.replace('Item', ''));
        return engraver__ok({ polys: polys, w: b[2] - b[0], h: b[1] - b[3], name: name });
    } catch (e) {
        return engraver__err(e);
    }
}

// Closed outlines of everything in a container, Bezier curves sampled into points, y pointing up.
function engraver__flatten(container, out) {
    var items = container.pageItems;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.typename === 'GroupItem') engraver__flatten(it, out);
        else if (it.typename === 'CompoundPathItem') {
            for (var j = 0; j < it.pathItems.length; j++) engraver__flattenPath(it.pathItems[j], out);
        } else if (it.typename === 'PathItem') engraver__flattenPath(it, out);
    }
}

function engraver__flattenPath(p, out) {
    if (p.guides || p.clipping) return;
    var pts = p.pathPoints, n = pts.length, a = [];
    if (n < 2) return;
    var segs = p.closed ? n : n - 1;
    for (var i = 0; i < segs; i++) {
        var p0 = pts[i], p1 = pts[(i + 1) % n];
        var x0 = p0.anchor[0], y0 = p0.anchor[1], x1 = p0.rightDirection[0], y1 = p0.rightDirection[1];
        var x2 = p1.leftDirection[0], y2 = p1.leftDirection[1], x3 = p1.anchor[0], y3 = p1.anchor[1];
        var straight = x1 === x0 && y1 === y0 && x2 === x3 && y2 === y3, steps = straight ? 1 : 8;
        for (var s = 0; s < steps; s++) {
            var t = s / steps, u = 1 - t;
            a.push(Math.round((u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3) * 100) / 100,
                   Math.round((u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3) * 100) / 100);
        }
    }
    if (a.length >= 6) out.push(a);
}

// Particles: copies of the remembered object (or instances of a symbol made from it), each one scaled,
// rotated and centred on its point. d = [x, y, size (longest side, pt), rotation (deg), ...].
function engraver__instances(doc, g, L, color, mode) {
    var P = $.global.__azmeelParticle, d = engraver__nums(L.inst), count = 0;
    if (!P) throw new Error('The particle object is gone. Select it again and press "Use selected object".');
    try { P.item.typename; } catch (e) { throw new Error('The particle object was deleted. Select a new one and press "Use selected object".'); }
    var base = Math.max(P.w, P.h) || 1, proto = null, sym = null;
    if (mode === 'symbol') {
        try { sym = P.symbol && P.symbol.name ? P.symbol : null; } catch (e1) { sym = null; }
        if (!sym) {
            // From a visible copy: a symbol made from a hidden object has hidden instances.
            var vis = P.item.duplicate(g, ElementPlacement.PLACEATEND);
            vis.hidden = false;
            sym = doc.symbols.add(vis);
            vis.remove();
            try { sym.name = 'Azmeel particle'; } catch (e2) {}
            P.symbol = sym;
        }
    } else {
        proto = P.item.duplicate(g, ElementPlacement.PLACEATEND);
        if (proto.hidden) proto.hidden = false;
        if (color && L.recolor) engraver__recolor(proto, color);
        var pb = proto.geometricBounds;
        var pcx = (pb[0] + pb[2]) / 2, pcy = (pb[1] + pb[3]) / 2;
    }
    for (var i = 0; i + 3 < d.length; i += 4) {
        var it = sym ? g.symbolItems.add(sym) : proto.duplicate(g, ElementPlacement.PLACEATEND);
        var pct = d[i + 2] / base * 100;
        it.resize(pct, pct, true, true, true, true, pct, Transformation.CENTER);
        if (d[i + 3]) it.rotate(d[i + 3], true, true, true, true, Transformation.CENTER);
        if (proto) it.translate(d[i] - pcx, d[i + 1] - pcy);
        else {
            var b = it.geometricBounds;
            it.translate(d[i] - (b[0] + b[2]) / 2, d[i + 1] - (b[1] + b[3]) / 2);
        }
        count++;
    }
    if (proto) proto.remove();
    return count;
}

// Paint every path inside an item with one colour (particles recoloured by the palette or image).
function engraver__recolor(it, color) {
    var t = it.typename, i;
    if (t === 'PathItem') { if (it.filled) it.fillColor = color; if (it.stroked) it.strokeColor = color; }
    else if (t === 'CompoundPathItem') { for (i = 0; i < it.pathItems.length; i++) engraver__recolor(it.pathItems[i], color); }
    else if (t === 'GroupItem') { for (i = 0; i < it.pageItems.length; i++) engraver__recolor(it.pageItems[i], color); }
    else if (t === 'TextFrame') { try { it.textRange.characterAttributes.fillColor = color; } catch (e) {} }
}

function engraver__overprint(p, on) {
    if (!on) return;
    try { if (p.filled) p.fillOverprint = true; if (p.stroked) p.strokeOverprint = true; } catch (e) {}
}

// Recipe metadata: an invisible tag on the artwork's top group (saved with the .ai file).
var ENGRAVER_TAG = 'AzmeelRecipe';
function engraver__tag(item, value) {
    try {
        var t = item.tags.add();
        t.name = ENGRAVER_TAG;
        t.value = value;
    } catch (e) {}
}

function engraver__readTag(item) {
    try {
        for (var i = 0; i < item.tags.length; i++) if (item.tags[i].name === ENGRAVER_TAG) return item.tags[i].value;
    } catch (e) {}
    return '';
}

// The Azmeel artwork around the selection: the nearest group (going up) that carries a recipe tag.
function engraver__findArt(item) {
    var p = item;
    while (p && p.typename !== 'Layer' && p.typename !== 'Document') {
        if (p.typename === 'GroupItem' && engraver__readTag(p)) return p;
        p = p.parent;
    }
    return null;
}

// "Edit in Azmeel" / "Update": the recipe of the selected Azmeel artwork. The artwork is remembered so
// an update can replace it in place.
function engraver_readRecipe() {
    try {
        if (app.documents.length === 0) return engraver__fail('Open a document and select an Azmeel artwork first.');
        var doc = app.activeDocument, sel = doc.selection;
        if (!sel || !(sel instanceof Array) || !sel.length) return engraver__fail('Select an artwork made with Azmeel Pro 2 first.');
        var art = engraver__findArt(sel[0]);
        if (!art) return engraver__fail('The selection has no Azmeel recipe. Only artwork made with Azmeel Pro 2 or later can be edited this way.');
        var b = art.geometricBounds, parts = [];
        // Ink separations: every top group of the same build carries the same recipe and id.
        var value = engraver__readTag(art), id = engraver__recipeId(value);
        var layer = art.layer;
        $.global.__azmeelTarget = { docName: doc.name, items: engraver__sameBuild(layer, id, art), layer: layer };
        var src = engraver__findSource(doc, value);
        return engraver__ok({ recipe: value, left: b[0], top: b[1], width: b[2] - b[0], height: b[1] - b[3], source: src });
    } catch (e) {
        return engraver__err(e);
    }
}

function engraver__recipeId(v) {
    var m = /(?:^|&)id=([^&]*)/.exec(v || '');
    return m ? m[1] : '';
}

function engraver__sameBuild(layer, id, art) {
    var out = [art];
    if (!id) return out;
    try {
        var all = layer.parent && layer.parent.typename === 'Layer' ? layer.parent : layer;
        engraver__collectTagged(all, id, out);
    } catch (e) {}
    return out;
}

function engraver__collectTagged(container, id, out) {
    var groups = container.groupItems;
    for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        var v = engraver__readTag(g);
        if (v && engraver__recipeId(v) === id) {
            var seen = false;
            for (var k = 0; k < out.length; k++) if (engraver__same(out[k], g)) seen = true;
            if (!seen) out.push(g);
        }
    }
    try { for (var j = 0; j < container.layers.length; j++) engraver__collectTagged(container.layers[j], id, out); } catch (e) {}
}

// The source image named in a recipe ("src=<kind>:<file name>:<w>x<h>"), if it is still in the document.
function engraver__findSource(doc, value) {
    var m = /(?:^|&)src=([^&]*)/.exec(value || '');
    if (!m) return null;
    var s = decodeURIComponent(m[1]).split('|'), kind = s[0], name = s[1] || '';
    function scan(col, k) {
        for (var i = 0; i < col.length; i++) {
            var it = col[i], nm = it.name || '';
            if (k === 'placed') { try { nm = nm || decodeURI(it.file.name); } catch (e) {} }
            if (name && nm === name) return { kind: k, index: i, name: nm };
        }
        return null;
    }
    return scan(doc.placedItems, 'placed') || scan(doc.rasterItems, 'raster');
}

// Every image in the selection (for batch generation).
function engraver_selectedImages() {
    try {
        if (app.documents.length === 0) return engraver__ok({ items: [] });
        var doc = app.activeDocument, sel = doc.selection, out = [];
        if (!sel || !(sel instanceof Array)) return engraver__ok({ items: [] });
        for (var i = 0; i < sel.length; i++) {
            var it = sel[i], col = it.typename === 'PlacedItem' ? doc.placedItems : it.typename === 'RasterItem' ? doc.rasterItems : null;
            if (!col) continue;
            for (var j = 0; j < col.length; j++) {
                if (engraver__same(col[j], it)) {
                    var nm = it.name;
                    if (!nm && it.typename === 'PlacedItem') { try { nm = decodeURI(it.file.name); } catch (e) {} }
                    out.push({ kind: it.typename === 'PlacedItem' ? 'placed' : 'raster', index: j, name: nm || ('Image ' + (out.length + 1)) });
                    break;
                }
            }
        }
        return engraver__ok({ items: out });
    } catch (e) {
        return engraver__err(e);
    }
}

function engraver__same(a, b) {
    try { if (a.uuid && b.uuid) return a.uuid === b.uuid; } catch (e) {}
    try { return a.typename === b.typename && String(a.geometricBounds) === String(b.geometricBounds); } catch (e2) { return false; }
}

// Where a build goes. Without Pro options: a new layer "Engraving" with one group per layer, exactly as
// before. With Pro options (data.pro): one top group "Azmeel art" carrying the recipe tag; or, with ink
// separation, one sub-layer per ink (AZMEEL_INK_<NAME>) each holding a tagged group. An update puts the
// new artwork in the layer of the artwork it replaces.
function engraver__targets(doc, data) {
    var pro = data.pro || null, T = { pro: pro, layer: null, groups: {}, tops: [], inks: 0 };
    var target = pro && pro.replace ? $.global.__azmeelTarget : null;
    if (target) { try { target.layer.name; } catch (e) { target = null; } }
    if (target) T.layer = /^AZMEEL_INK_/.test(target.layer.name) && target.layer.parent.typename === 'Layer' ? target.layer.parent : target.layer;
    else if (pro && pro.joinLayer) {
        // Batch "groups": every artwork goes into one shared layer.
        try { T.layer = doc.layers.getByName(pro.joinLayer); } catch (e) { T.layer = null; }
        if (!T.layer) { T.layer = doc.layers.add(); T.layer.name = pro.joinLayer; }
        T.joined = true;
    } else {
        T.layer = doc.layers.add();
        T.layer.name = pro && pro.layerName ? pro.layerName : 'Engraving';
    }
    T.container = function (L) {
        if (!pro) return T.layer;
        var key = pro.separate ? engraver__inkName(L, data) : '';
        if (T.groups[key]) return T.groups[key];
        var holder = T.layer;
        if (pro.separate) {
            holder = T.layer.layers.add();
            holder.name = 'AZMEEL_INK_' + key;
            T.inks++;
        }
        var top = holder.groupItems.add();
        top.name = pro.separate ? 'Azmeel ' + key : (pro.artName || 'Azmeel art');
        if (pro.recipe) engraver__tag(top, pro.recipe);
        T.tops.push(top);
        return (T.groups[key] = top);
    };
    return T;
}

function engraver__buildText(text) {
    var layer = null, T = null, newLayer = false;
    try {
        if (app.documents.length === 0) return engraver__fail('No open document.');
        var data = eval(text);
        var doc = app.activeDocument, pro = data.pro || null;
        var color = engraver__color(doc, data.color);

        T = engraver__targets(doc, data);
        layer = T.layer;
        newLayer = !(pro && pro.replace && $.global.__azmeelTarget) && !T.joined;
        var count = 0, groups = [], bad = { count: 0, first: '' };

        for (var li = 0; li < data.layers.length; li++) {
            var L = data.layers[li];
            L.polys = engraver__polys(L.polys);
            if (L.dots) L.dots = engraver__nums(L.dots);
            var hasDots = L.dots && L.dots.length;
            if (!L.polys.length && !hasDots && !L.rect && !L.glyphs && !L.inst) continue;
            var g = T.container(L).groupItems.add();
            g.name = L.name;
            groups.push(g);
            var lc = engraver__layerColor(doc, L, data, pro);
            if (L.gradient) {
                try { lc = engraver__gradient(doc, L.gradient); } catch (eg) { /* keep the flat colour */ }
            }
            if (L.opacity != null) g.opacity = Math.max(0, Math.min(100, L.opacity * 100));
            if (L.blend) g.blendingMode = engraver__blend(L.blend);
            var cap = L.cap === 'round' ? StrokeCap.ROUNDENDCAP : StrokeCap.BUTTENDCAP;
            var op = !!(pro && pro.overprint);

            if (L.inst) {
                count += engraver__instances(doc, g, L, lc, L.particle || 'paths');
                continue;
            }

            if (L.glyphs) {
                count += engraver__glyphs(doc, g, L, lc);
                continue;
            }

            if (L.rect) {
                // rect: [left, top, width, height] in document coordinates.
                var bg = g.pathItems.rectangle(L.rect[1], L.rect[0], L.rect[2], L.rect[3]);
                engraver__fill(bg, lc);
                if (L.gradient) engraver__aimGradient(bg, L.gradient);
                count++;
                continue;
            }

            if (hasDots) {
                // dots: [x, y, r, ...]. One compound path per 2000 dots keeps the file responsive,
                // and styling a compound once is far faster than styling every dot.
                var d = L.dots, n = d.length / 3, square = L.shape === 'square';
                for (var c0 = 0; c0 < n; c0 += 2000) {
                    var dcp = g.compoundPathItems.add();
                    for (var di = c0; di < Math.min(n, c0 + 2000); di++) {
                        var x = d[3 * di], y = d[3 * di + 1], r = d[3 * di + 2];
                        if (square) dcp.pathItems.rectangle(y + r, x - r, 2 * r, 2 * r);
                        else dcp.pathItems.ellipse(y + r, x - r, 2 * r, 2 * r);
                    }
                    engraver__fill(dcp.pathItems[0], lc);
                    engraver__overprint(dcp.pathItems[0], op);
                    count += Math.min(n, c0 + 2000) - c0;
                }
                continue;
            }

            if (L.evenodd) {
                // Shapes with holes (solid shadows): one compound path, even-odd fill.
                var cp = g.compoundPathItems.add();
                for (var c = 0; c < L.polys.length; c++) {
                    var sub = engraver__addPath(cp.pathItems, L.polys[c], bad);
                    if (!sub) continue;
                    sub.closed = true;
                    count++;
                }
                if (!cp.pathItems.length) { cp.remove(); continue; }
                var first = cp.pathItems[cp.pathItems.length - 1];
                first.stroked = false;
                first.filled = true;
                first.fillColor = lc;
                first.evenodd = true;
                engraver__overprint(first, op);
                continue;
            }

            if ((L.open && L.stroke > 0 && L.polys.length > 200) || (L.compound && !L.open && !(L.stroke > 0))) {
                // Many marks: compound paths of 2000, styled once, like the dots - thousands of separate
                // paths are very slow. Open strokes (cross stitches, grid lines) or filled shapes
                // (Pro marks: diamonds, tiles, cells...) that are flagged `compound`.
                var filled = !L.open;
                for (var s0 = 0; s0 < L.polys.length; s0 += 2000) {
                    var scp = g.compoundPathItems.add();
                    var s1 = Math.min(L.polys.length, s0 + 2000);
                    for (var si = s0; si < s1; si++) {
                        var sp = engraver__addPath(scp.pathItems, L.polys[si], bad);
                        if (sp) sp.closed = filled;
                    }
                    if (!scp.pathItems.length) { scp.remove(); continue; }
                    var st = scp.pathItems[0];
                    if (filled) engraver__fill(st, lc);
                    else {
                        st.filled = false;
                        st.stroked = true;
                        st.strokeColor = lc;
                        st.strokeWidth = L.stroke;
                        st.strokeJoin = StrokeJoin.ROUNDENDJOIN;
                        st.strokeCap = cap;
                    }
                    engraver__overprint(st, op);
                    count += s1 - s0;
                }
                continue;
            }

            for (var i = 0; i < L.polys.length; i++) {
                var p = engraver__addPath(g.pathItems, L.polys[i], bad);
                if (!p) continue;
                p.closed = !L.open;
                if (L.stroke > 0) {
                    p.filled = false;
                    p.stroked = true;
                    p.strokeColor = lc;
                    p.strokeWidth = L.stroke;
                    p.strokeJoin = StrokeJoin.ROUNDENDJOIN;
                    p.strokeCap = cap;
                } else {
                    p.stroked = false;
                    p.filled = true;
                    p.fillColor = lc;
                }
                engraver__overprint(p, op);
                count++;
            }
        }

        if (data.text && data.text.items.length) {
            var textHolder = pro ? T.container({ color: data.text.color, k: data.text.k }) : layer;
            count += engraver__brandText(doc, textHolder, data.text);
            groups.push(textHolder.groupItems[0]);
        }

        if (data.hideSource) {
            var src = engraver__source();
            if (src) for (var k = 0; k < src.length; k++) src[k].hidden = true;
        }

        // Update: the new artwork is in place, so the one it replaces can go.
        var replaced = 0;
        if (pro && pro.replace && $.global.__azmeelTarget) {
            var old = $.global.__azmeelTarget.items;
            for (var oi = 0; oi < old.length; oi++) { try { old[oi].remove(); replaced++; } catch (er) {} }
            $.global.__azmeelTarget = null;
            // Ink sub-layers of the old artwork that are now empty.
            for (var sl = layer.layers.length - 1; sl >= 0; sl--) {
                var sub2 = layer.layers[sl];
                try { if (/^AZMEEL_INK_/.test(sub2.name) && sub2.pageItems.length === 0 && sub2.layers.length === 0) sub2.remove(); } catch (es2) {}
            }
        }

        // Batch: an artboard around the new artwork.
        if (pro && pro.artboard && T.tops.length) {
            try {
                var ab = engraver__unionBounds(T.tops), m = pro.artboardMargin || 0;
                doc.artboards.add([ab[0] - m, ab[1] + m, ab[2] + m, ab[3] - m]);
            } catch (eab) {}
        }

        doc.selection = null;
        var sel = pro ? T.tops : groups;
        for (var s = 0; s < sel.length; s++) try { sel[s].selected = true; } catch (es) {}
        app.redraw();
        var res = { paths: count, layer: layer.name };
        if (T.inks) res.inks = T.inks;
        if (replaced) res.replaced = replaced;
        if (bad.thinned) res.simplified = bad.thinned;
        if (bad.count) {
            // Keep the data so the problem can be looked at later.
            res.skipped = bad.count;
            res.skipInfo = bad.first;
            try {
                var keep = new File(Folder.temp.fsName + '/azmeel_skipped_shapes.txt');
                keep.encoding = 'UTF-8';
                keep.open('w');
                keep.write('// ' + bad.count + ' shapes skipped. First: ' + bad.first + '\n' +
                    '// Illustrator ' + app.version + ', document ' + doc.name + ', ruler units ' + doc.rulerUnits +
                    (doc.scaleFactor !== undefined ? ', scale factor ' + doc.scaleFactor : '') + '\n' + text);
                keep.close();
                res.skipFile = keep.fsName;
            } catch (ignore) {}
        }
        return engraver__ok(res);
    } catch (e) {
        // Don't leave a half-built layer (or half-built groups in an existing layer) behind.
        try {
            if (layer && newLayer) layer.remove();
            else if (T) for (var ti = 0; ti < T.tops.length; ti++) T.tops[ti].remove();
        } catch (ignore) {}
        return engraver__err(e);
    }
}
