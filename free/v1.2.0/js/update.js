/* Azmeel by Bu Khalil Studio — in-panel updates (both editions; loaded after main.js).
 * Reads <UPDATE_URL>latest.json, checks its ECDSA P-256 signature against PUBLIC_KEY, downloads the files of the new
 * version from <UPDATE_URL>v<version>/, checks the size and SHA-256 of every file, then writes them over the installed
 * extension (backing up what it replaces) and reloads the panel. host.jsx evals what the panel sends it, so nothing
 * that is not signed by build/cert/update-key.pem is ever written: a changed or hacked server cannot push code.
 * The files are those of the signed .zxp (META-INF/signatures.xml included), so a signed install stays valid.
 * Copyright (c) 2026 Bu Khalil Studio (Ibrahim Khalil). All rights reserved. */
(function () {
  'use strict';

  var UPDATE_URL = "https://raw.githubusercontent.com/ibrahimkhalil441/azmeel-updates/main/free/";                 // set per edition by build/package.js; empty = no updates (source tree, mock)
  var PUBLIC_KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEOQEfbOGLO3RALeum/5H0DvQM7z80SozkbXGZ5bEU8naxe3DcagLhbC3uQ8T34r+K/qmPlTaBYnIeL6mlYF4bSw==';
  var PRO = window.AzmeelPro;
  var PRODUCT = PRO ? 'azmeel-pro' : 'azmeel', EXT_ID = PRO ? 'com.bukhalil.azmeel.pro' : 'com.bukhalil.azmeel';
  var VERSION = PRO ? PRO.version : window.AZMEEL_VERSION;
  var KEY = 'azmeel.update.' + PRODUCT + '.';
  var CHECK_EVERY = 6 * 3600 * 1000, MAX_FILES = 400, MAX_BYTES = 40 * 1024 * 1024;
  var VER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/, HASH_RE = /^[0-9a-f]{64}$/;
  var PATH_RE = /^[A-Za-z0-9][A-Za-z0-9 ._\-]*(\/[A-Za-z0-9][A-Za-z0-9 ._\-]*)*$/;   // no "..", no leading "/" or "."
  var bar = null, busy = false, offer = null;
  var LINE_SEP = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');   // not valid inside an ExtendScript string literal

  function url() { return UPDATE_URL || (window.MOCK && window.MOCK.updateUrl) || ''; }
  function get(k) { try { return localStorage.getItem(KEY + k); } catch (e) { return null; } }
  function put(k, v) { try { if (v == null) localStorage.removeItem(KEY + k); else localStorage.setItem(KEY + k, v); } catch (e) {} }

  function newer(a, b) {
    var x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (var i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  }
  function b64ToBytes(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function bytesToB64(buf) {
    var u = new Uint8Array(buf), out = '';
    for (var i = 0; i < u.length; i += 0x8000) out += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(out);
  }
  function hex(buf) { return [].map.call(new Uint8Array(buf), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
  function subtle() { return window.crypto && window.crypto.subtle; }
  function okPath(p) { return typeof p === 'string' && p.length <= 200 && PATH_RE.test(p); }

  function fromFileUrl(p) {
    p = String(p || '');
    try { p = decodeURI(p); } catch (e) {}
    return p.replace(/^file:\/\/\/(?=[A-Za-z]:)/, '').replace(/^file:\/\//, '').replace(/[\/\\]+$/, '');
  }
  function extRoot() {
    var p = '';
    try { p = fromFileUrl(window.__adobe_cep__.getSystemPath('extension')); } catch (e) {}
    p = p.replace(/\\/g, '/');
    // Only ever write into this edition's own folder.
    return p.slice(p.lastIndexOf('/') + 1) === EXT_ID ? p : '';
  }
  function fs() { return window.cep && window.cep.fs; }

  /* ----------------------------------------------------------- the offer */

  // latest.json = { payload: "<JSON string>", sig: "<base64 r||s>" }. The payload is parsed only after the
  // signature over its exact bytes checks out, then every field is validated again.
  function verify(text) {
    var d;
    try { d = JSON.parse(text); } catch (e) { return Promise.reject(new Error('The update information is damaged.')); }
    if (!d || typeof d.payload !== 'string' || typeof d.sig !== 'string' || d.payload.length > 200000) return Promise.reject(new Error('The update information is damaged.'));
    var S = subtle();
    if (!S) return Promise.reject(new Error('This Illustrator cannot check update signatures.'));
    return S.importKey('spki', b64ToBytes(PUBLIC_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      .then(function (key) {
        var sig; try { sig = b64ToBytes(d.sig); } catch (e) { sig = new Uint8Array(0); }
        return S.verify({ name: 'ECDSA', hash: { name: 'SHA-256' } }, key, sig, new TextEncoder().encode(d.payload));
      })
      .then(function (ok) {
        if (!ok) throw new Error('The update is not signed by Bu Khalil Studio. Nothing was changed.');
        var p = JSON.parse(d.payload), total = 0;
        if (!p || p.product !== PRODUCT || !VER_RE.test(p.version) || !(p.files instanceof Array) || !p.files.length || p.files.length > MAX_FILES)
          throw new Error('The update information does not fit this edition.');
        p.files.forEach(function (f) {
          if (!f || !okPath(f.p) || !HASH_RE.test(f.h) || !(f.s >= 0 && f.s <= MAX_BYTES && Math.floor(f.s) === f.s)) throw new Error('The update lists a file it may not write.');
          total += f.s;
        });
        if (total > MAX_BYTES) throw new Error('The update is too large.');
        var rem = p.removed instanceof Array ? p.removed : [];
        if (rem.length > MAX_FILES || !rem.every(okPath)) throw new Error('The update lists a file it may not remove.');
        p.removed = rem;
        p.page = typeof p.page === 'string' && /^https:\/\/[^\s"'<>]{1,300}$/.test(p.page) ? p.page : '';
        p.notes = typeof p.notes === 'string' ? p.notes.slice(0, 600) : '';
        return p;
      });
  }

  // Pro: the Gumroad license key goes (as a header, only to the update server) with every request; the server
  // checks it before it hands out the files. HTTP errors carry the server's message and status.
  function fetchOk(u, type) {
    var opt = { cache: 'no-store' }, key = license();
    if (PRO && key) opt.headers = { 'X-Azmeel-License': key };
    return fetch(u + (u.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), opt).then(function (r) {
      if (r.ok) return type === 'text' ? r.text() : r.arrayBuffer();
      return r.text().then(function (t) {
        var msg = '';
        try { msg = String(JSON.parse(t).error || '').slice(0, 200); } catch (e) {}
        var err = new Error(msg || 'The update server answered ' + r.status + '.');
        err.status = r.status; err.server = true;
        throw err;
      });
    }, function () {
      throw new Error('Could not reach the update server. Check the internet connection.');
    });
  }

  /* ------------------------------------------------------- license (Pro) */

  // Kept in localStorage and in the user data folder (survives a CEF cache reset), like My styles.
  function licenseFile() {
    var d = '';
    try { d = fromFileUrl(window.__adobe_cep__.getSystemPath('userData')).replace(/\\/g, '/'); } catch (e) {}
    return d ? d + '/Bu Khalil Studio/Azmeel Pro/license.txt' : '';
  }
  function cleanKey(k) { k = String(k || '').trim(); return /^[A-Za-z0-9-]{8,80}$/.test(k) ? k : ''; }
  function license() {
    if (!PRO) return '';
    var k = cleanKey(get('license'));
    if (!k && fs() && licenseFile()) { var r = fs().readFile(licenseFile()); if (r && !r.err) { k = cleanKey(r.data); if (k) put('license', k); } }
    return k;
  }
  function setLicense(k) {
    put('license', k || null);
    var f = licenseFile();
    if (fs() && f) {
      var dir = f.slice(0, f.lastIndexOf('/'));
      [dir.slice(0, dir.lastIndexOf('/')), dir].forEach(function (d) { try { fs().makedir(d); } catch (e) {} });
      try { if (k) fs().writeFile(f, k); else fs().deleteFile(f); } catch (e) {}
    }
  }
  function showLicense(msg) {
    var b = ensureBar(), btns = b.querySelector('.update-btns');
    b.hidden = false; b.className = 'update-bar license' + (msg ? ' err' : '');
    b.querySelector('.update-text').textContent = msg || 'Enter your Azmeel Pro license key (it is in your Gumroad receipt) to get updates.';
    btns.innerHTML = '';
    var inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'text-input update-key'; inp.placeholder = 'License key'; inp.spellcheck = false; inp.value = license();
    function save() {
      var k = cleanKey(inp.value);
      if (!k) { b.querySelector('.update-text').textContent = 'That does not look like a license key. Copy it from your Gumroad receipt.'; b.className = 'update-bar license err'; return; }
      setLicense(k);
      check(true);
    }
    inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') save(); });
    btns.appendChild(inp);
    btns.appendChild(button('btn primary sm', 'Save', save));
    btns.appendChild(button('link', 'Close', hide));
    setTimeout(function () { inp.focus(); }, 30);
  }

  // manual: show "up to date" and errors too. Resolves to the offer (or null).
  function check(manual) {
    var base = url();
    if (!base || !VERSION || busy) return Promise.resolve(null);
    if (PRO && !license()) { if (manual) showLicense(); return Promise.resolve(null); }
    if (manual) show('Checking for updates…');
    put('checked', String(Date.now()));
    return fetchOk(base + 'latest.json', 'text')
      .then(verify)
      .then(function (p) {
        if (!newer(p.version, VERSION)) { if (manual) show('Azmeel' + (PRO ? ' Pro ' : ' ') + VERSION + ' is up to date.', 'ok', true); return null; }
        offer = p;
        showOffer(p);
        return p;
      })
      .catch(function (e) {
        // A refused key is worth telling even on the automatic check (once per start).
        if (PRO && (e.status === 401 || e.status === 403)) showLicense(e.message);
        else if (manual) show(e.message, 'err', true);
        return null;
      });
  }

  /* --------------------------------------------------------------- install */

  function install(p) {
    var F = fs(), root = extRoot(), base = url() + 'v' + p.version + '/';
    if (busy) return Promise.resolve(false);
    if (!F || !root || !writable(root)) {
      show('This copy cannot update itself (it is installed for all users). Download Azmeel' + (PRO ? ' Pro ' : ' ') + p.version + ' and run its installer.', 'err', true, p.page || url());
      return Promise.resolve(false);
    }
    busy = true;
    var got = {}, n = 0, S = subtle();
    function next(i) {
      if (i >= p.files.length) return Promise.resolve();
      var f = p.files[i];
      show('Downloading the update… ' + (i + 1) + ' / ' + p.files.length);
      return fetchOk(base + f.p.split('/').map(encodeURIComponent).join('/'), 'buf').then(function (buf) {
        if (buf.byteLength !== f.s) throw new Error('A file of the update is incomplete (' + f.p + '). Nothing was changed.');
        return S.digest('SHA-256', buf).then(function (h) {
          if (hex(h) !== f.h) throw new Error('A file of the update does not match its signature (' + f.p + '). Nothing was changed.');
          got[f.p] = bytesToB64(buf);
          return next(i + 1);
        });
      });
    }
    return next(0).then(function () {
      // Everything is here and checked: back up, then write (manifest and page last).
      var order = p.files.map(function (f) { return f.p; }).sort(function (a, b) { return rank(a) - rank(b); });
      var backup = {}, done = [];
      order.forEach(function (rel) {
        var r = F.readFile(root + '/' + rel, window.cep.encoding.Base64);
        backup[rel] = r && !r.err ? r.data : null;
      });
      try {
        order.forEach(function (rel) {
          makeDirs(root, rel);
          var w = F.writeFile(root + '/' + rel, got[rel], window.cep.encoding.Base64);
          if (!w || w.err) throw new Error('Could not write ' + rel + ' (error ' + (w && w.err) + ').');
          done.push(rel); n++;
        });
      } catch (e) {
        done.forEach(function (rel) {
          try { if (backup[rel] != null) F.writeFile(root + '/' + rel, backup[rel], window.cep.encoding.Base64); else F.deleteFile(root + '/' + rel); } catch (e2) {}
        });
        throw new Error(e.message + ' The old version was put back.');
      }
      p.removed.forEach(function (rel) { if (!got[rel]) try { F.deleteFile(root + '/' + rel); } catch (e) {} });
      put('done', p.version);
      show('Updated to ' + p.version + '. Reloading…', 'ok');
      // The page reload does not re-read host.jsx: load the new one into Illustrator first.
      return new Promise(function (resolve) {
        var js = '$.evalFile(new File(' + JSON.stringify(root + '/jsx/host.jsx').replace(LINE_SEP, function (c) { return '\\u' + c.charCodeAt(0).toString(16); }) + '));"ok"';
        try { window.__adobe_cep__.evalScript(js, function () { resolve(); }); } catch (e) { resolve(); }
        setTimeout(resolve, 3000);
      }).then(function () { busy = false; setTimeout(function () { location.reload(); }, 400); return true; });
    }).catch(function (e) {
      busy = false;
      show(e.message || String(e), 'err', true);
      return false;
    });
  }
  function rank(rel) { return rel === 'CSXS/manifest.xml' ? 3 : rel === 'index.html' ? 2 : /^META-INF\//.test(rel) ? 1 : 0; }
  function makeDirs(root, rel) {
    var parts = rel.split('/'), d = root;
    for (var i = 0; i < parts.length - 1; i++) { d += '/' + parts[i]; try { fs().makedir(d); } catch (e) {} }
  }
  function writable(root) {
    var t = root + '/.azmeel-write-test';
    try {
      var w = fs().writeFile(t, 'ok');
      if (!w || w.err) return false;
      fs().deleteFile(t);
      return true;
    } catch (e) { return false; }
  }

  /* -------------------------------------------------------------------- UI */

  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'update-bar'; bar.id = 'updateBar'; bar.hidden = true;
    bar.innerHTML = '<span class="update-text"></span><span class="update-btns"></span>';
    var foot = document.querySelector('footer');
    foot.parentNode.insertBefore(bar, foot);
    return bar;
  }
  function button(cls, text, fn) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = text;
    b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
    return b;
  }
  // kind: '' (progress), 'ok', 'err'. closable adds a close button; link (a URL) adds "Download".
  function show(text, kind, closable, link) {
    var b = ensureBar(), btns = b.querySelector('.update-btns');
    b.hidden = false;
    b.className = 'update-bar ' + (kind || '');
    b.querySelector('.update-text').textContent = text;
    btns.innerHTML = '';
    if (link) btns.appendChild(button('btn sm', 'Download', function () { openLink(link); }));
    if (closable) btns.appendChild(button('link', 'Close', hide));
  }
  function hide() { if (bar) bar.hidden = true; }
  function showOffer(p) {
    show('Azmeel' + (PRO ? ' Pro ' : ' ') + p.version + ' is available.' + (p.notes ? ' ' + p.notes : ''), 'offer');
    var btns = bar.querySelector('.update-btns');
    btns.appendChild(button('btn primary sm', 'Update', function () { install(p); }));
    btns.appendChild(button('link', 'Later', hide));
  }
  function openLink(u) {
    try { window.cep.util.openURLInDefaultBrowser(u); } catch (e) { window.open(u); }
  }

  function start() {
    if (!VERSION) return;
    var just = get('done');
    if (just) {
      put('done', null);
      if (just === VERSION) show('Azmeel' + (PRO ? ' Pro' : '') + ' was updated to ' + VERSION + '.', 'ok', true);
    }
    // "Check for updates" under the version on the About screen.
    var v = document.getElementById('aboutVersion');
    if (v && url()) {
      var c = button('link about-update', 'Check for updates', function () {
        var close = document.getElementById('btnAboutClose');
        if (close) close.click();
        check(true);
      });
      v.parentNode.insertBefore(c, v.nextSibling);
      if (PRO) {
        var lk = button('link about-update', 'License key…', function () {
          var close = document.getElementById('btnAboutClose');
          if (close) close.click();
          showLicense();
        });
        c.parentNode.insertBefore(lk, c.nextSibling);
      }
    }
    var last = +get('checked') || 0;
    if (url() && Date.now() - last > CHECK_EVERY) setTimeout(function () { check(false); }, 6000);
  }

  window.AzmeelUpdate = { check: check, install: function () { return offer ? install(offer) : Promise.resolve(false); }, verify: verify,
                          offer: function () { return offer; }, root: extRoot, license: license, setLicense: setLicense };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
