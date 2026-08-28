(function() {
var CANVAS_SIZE = 64;
var PIXEL_COUNT = CANVAS_SIZE * CANVAS_SIZE;
var BACKGROUND_INDEX = 7;

var PALETTE = [
  '#000000','#1d2b53','#7e2553','#008751',
  '#ab5236','#5f574f','#c2c3c7','#fff1e8',
  '#ff004d','#ffa300','#ffec27','#00e436',
  '#29adff','#83769c','#ff77a8','#ffccaa'
];

var state = window.__GUESTBOOK_DATA__;
if (!state) return;

var entries = state.entries || [];
var currentEntry = state.currentEntry || null;
var user = state.user || null;
var siteAdmin = state.siteAdmin || null;
var userBanned = state.userBanned || false;
var authError = state.authError || null;
var discordConfigured = state.discordConfigured !== false;
var bans = state.bans || [];

var adminMode = false;
var adminEditingEntry = null;

var pixels = null;
var tool = 'brush';
var brushSize = 1;
var colorIndex = 0;
var undoStack = [];
var redoStack = [];
var gestureBase = null;
var gestureStart = null;
var gestureLast = null;
var isDrawing = false;

var canvas = null;
var ctx = null;

function init() {
  renderAll();
}

function renderAll() {
  renderGallery();
  renderSigningArea();
  renderAdminMode();
  renderBanList();
}

function renderGallery() {
  var gallery = document.querySelector('.guestbook-gallery');
  if (!gallery) return;
  var grid = gallery.querySelector('.guestbook-grid');
  if (!grid && entries.length > 0) {
    var emptyEl = gallery.querySelector('.guestbook-empty');
    if (emptyEl) emptyEl.remove();
    grid = document.createElement('div');
    grid.className = 'guestbook-grid';
    gallery.appendChild(grid);
  }
  if (!grid) return;
  var sorted = entries.slice().sort(function(a,b) {
    if (currentEntry && a.id === currentEntry.id) return -1;
    if (currentEntry && b.id === currentEntry.id) return 1;
    return b.createdAt - a.createdAt;
  });
  grid.innerHTML = '';
  sorted.forEach(function(entry) {
    grid.appendChild(makeEntryCard(entry));
  });
  var countEl = gallery.querySelector('h3 span');
  if (countEl) countEl.textContent = entries.length + ' entries';
}

function makeEntryCard(entry) {
  var isMine = currentEntry && entry.id === currentEntry.id;
  var isBanned = bans.some(function(b) { return b.entryId === entry.id || b.username === entry.username; });
  var div = document.createElement('div');
  div.className = 'guestbook-entry' + (isMine ? ' is-mine' : '') + (isBanned ? ' is-banned' : '');
  div.dataset.entryId = entry.id;

  var cvs = document.createElement('canvas');
  cvs.width = CANVAS_SIZE;
  cvs.height = CANVAS_SIZE;
  cvs.className = 'guestbook-preview-canvas';
  cvs.setAttribute('aria-label', entry.displayName + "'s pixel-art signature");
  paintPreviewCanvas(cvs, decodePixels(entry.pixels));
  div.appendChild(cvs);

  var meta = document.createElement('div');
  meta.className = 'guestbook-entry-meta';
  var strong = document.createElement('strong');
  strong.textContent = entry.displayName;
  var usernameSpan = document.createElement('span');
  usernameSpan.textContent = '@' + entry.username;
  var timeEl = document.createElement('time');
  var d = new Date(entry.createdAt * 1000);
  timeEl.dateTime = d.toISOString();
  timeEl.textContent = d.toLocaleDateString();
  meta.appendChild(strong);
  meta.appendChild(usernameSpan);
  meta.appendChild(timeEl);
  div.appendChild(meta);

  if (siteAdmin && adminMode) {
    var actions = document.createElement('div');
    actions.className = 'guestbook-admin-entry-actions';

    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.title = 'edit';
    editBtn.innerHTML = '&#9998;';
    editBtn.addEventListener('click', function() { startAdminEdit(entry); });

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.title = 'delete';
    deleteBtn.innerHTML = '&#128465;';
    deleteBtn.addEventListener('click', function() { adminDeleteEntry(entry.id); });

    var banBtn = document.createElement('button');
    banBtn.type = 'button';
    banBtn.title = isBanned ? 'unban' : 'ban';
    banBtn.innerHTML = isBanned ? '&#128275;' : '&#128274;';
    banBtn.addEventListener('click', function() {
      if (isBanned) {
        var ban = bans.find(function(b) { return b.entryId === entry.id || b.username === entry.username; });
        if (ban) adminUnban(ban.id);
      } else {
        adminBan(entry.id);
      }
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    actions.appendChild(banBtn);
    div.appendChild(actions);
  }

  return div;
}

function paintPreviewCanvas(cvs, px) {
  var c = cvs.getContext('2d');
  if (!c) return;
  var img = c.createImageData(CANVAS_SIZE, CANVAS_SIZE);
  for (var i = 0; i < px.length; i++) {
    var hex = PALETTE[px[i]] || PALETTE[0];
    var r = parseInt(hex.slice(1,3),16);
    var g = parseInt(hex.slice(3,5),16);
    var b = parseInt(hex.slice(5,7),16);
    img.data[i*4] = r;
    img.data[i*4+1] = g;
    img.data[i*4+2] = b;
    img.data[i*4+3] = 255;
  }
  c.putImageData(img, 0, 0);
}

function decodePixels(encoded) {
  if (!encoded || encoded.length !== PIXEL_COUNT) return blankPixels();
  return Array.from(encoded, function(ch) { return parseInt(ch, 16); });
}

function blankPixels() {
  var arr = new Array(PIXEL_COUNT);
  for (var i = 0; i < PIXEL_COUNT; i++) arr[i] = BACKGROUND_INDEX;
  return arr;
}

function encodePixels(px) {
  return px.map(function(v) { return v.toString(16); }).join('');
}

function renderSigningArea() {
  var area = document.querySelector('.guestbook-signing-area');
  if (!area) return;
  area.innerHTML = '';

  if (userBanned) {
    var banned = document.createElement('div');
    banned.className = 'guestbook-banned-self';
    banned.innerHTML = '<p>you have been banned from the guestbook.</p>';
    area.appendChild(banned);
    return;
  }

  if (!user) {
    if (!discordConfigured) {
      var notice = document.createElement('p');
      notice.className = 'guestbook-notice';
      notice.textContent = "discord login isn't configured on this server yet.";
      area.appendChild(notice);
    } else {
      var loginDiv = document.createElement('div');
      loginDiv.className = 'guestbook-heading';
      var desc = document.createElement('p');
      desc.textContent = 'sign the guestbook by drawing a 64\xd764 pixel-art piece.';
      var loginBtn = document.createElement('a');
      loginBtn.href = '/api/guestbook/auth/login';
      loginBtn.className = 'guestbook-command guestbook-login';
      loginBtn.textContent = 'sign in with discord';
      loginDiv.appendChild(desc);
      loginDiv.appendChild(loginBtn);
      area.appendChild(loginDiv);
    }
    return;
  }

  var heading = document.createElement('div');
  heading.className = 'guestbook-heading';
  var info = document.createElement('p');
  info.textContent = (currentEntry ? 'update' : 'create') + ' your pixel-art entry.';
  var account = document.createElement('div');
  account.className = 'guestbook-account';
  var nameSpan = document.createElement('span');
  nameSpan.textContent = user.displayName + ' (@' + user.username + ')';
  var logoutForm = document.createElement('form');
  logoutForm.method = 'post';
  logoutForm.action = '/api/guestbook/auth/logout';
  var logoutBtn = document.createElement('button');
  logoutBtn.type = 'submit';
  logoutBtn.className = 'guestbook-command';
  logoutBtn.textContent = 'sign out';
  logoutForm.appendChild(logoutBtn);
  account.appendChild(nameSpan);
  account.appendChild(logoutForm);
  heading.appendChild(info);
  heading.appendChild(account);
  area.appendChild(heading);

  if (authError) {
    var errDiv = document.createElement('div');
    errDiv.className = 'guestbook-notice';
    errDiv.textContent = authError;
    area.appendChild(errDiv);
  }

  initEditor(area, currentEntry ? decodePixels(currentEntry.pixels) : blankPixels());
}

function initEditor(container, initialPixels, onSave) {
  pixels = initialPixels.slice();
  undoStack = [];
  redoStack = [];

  var editorDiv = document.createElement('div');
  editorDiv.className = 'guestbook-editor';

  var toolbar = document.createElement('div');
  toolbar.className = 'guestbook-toolbar';
  toolbar.setAttribute('aria-label', 'drawing tools');

  var toolGroup = document.createElement('div');
  toolGroup.className = 'guestbook-tool-group';

  var tools = [
    {id:'brush', label:'Brush', icon:'&#9999;'},
    {id:'eraser', label:'Eraser', icon:'&#9003;'},
    {id:'line', label:'Line', icon:'&#9135;'},
    {id:'circle', label:'Circle', icon:'&#9711;'},
    {id:'fill', label:'Fill', icon:'&#9618;'}
  ];

  tools.forEach(function(t) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'guestbook-icon-button' + (tool === t.id ? ' is-active' : '');
    btn.setAttribute('aria-pressed', tool === t.id ? 'true' : 'false');
    btn.setAttribute('aria-label', t.label);
    btn.title = t.label;
    btn.innerHTML = t.icon;
    btn.dataset.tool = t.id;
    btn.addEventListener('click', function() {
      tool = t.id;
      document.querySelectorAll('[data-tool]').forEach(function(b) {
        var active = b.dataset.tool === tool;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
    });
    toolGroup.appendChild(btn);
  });

  var histGroup = document.createElement('div');
  histGroup.className = 'guestbook-tool-group';

  var undoBtn = makeIconBtn('&#8617;', 'Undo', function() { doUndo(); });
  var redoBtn = makeIconBtn('&#8618;', 'Redo', function() { doRedo(); });
  var resetBtn = makeIconBtn('&#8635;', 'Restore saved', function() { replaceCanvas(initialPixels); });
  var clearBtn = makeIconBtn('&#10005;', 'Clear', function() { replaceCanvas(blankPixels()); });

  undoBtn.id = 'gb-undo-btn';
  redoBtn.id = 'gb-redo-btn';
  undoBtn.disabled = true;
  redoBtn.disabled = true;

  histGroup.appendChild(undoBtn);
  histGroup.appendChild(redoBtn);
  histGroup.appendChild(resetBtn);
  histGroup.appendChild(clearBtn);

  var sizeCtrl = document.createElement('label');
  sizeCtrl.className = 'guestbook-size-control';
  sizeCtrl.innerHTML = 'brush <input type="range" min="1" max="4" value="1"><output>1</output>';
  var sizeInput = sizeCtrl.querySelector('input');
  var sizeOutput = sizeCtrl.querySelector('output');
  sizeInput.addEventListener('input', function() {
    brushSize = parseInt(sizeInput.value, 10);
    sizeOutput.value = brushSize;
  });

  toolbar.appendChild(toolGroup);
  toolbar.appendChild(histGroup);
  toolbar.appendChild(sizeCtrl);
  editorDiv.appendChild(toolbar);

  var palette = document.createElement('div');
  palette.className = 'guestbook-palette';
  PALETTE.forEach(function(hex, i) {
    var swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'guestbook-swatch';
    swatch.setAttribute('aria-pressed', i === colorIndex ? 'true' : 'false');
    swatch.style.background = hex;
    swatch.title = hex;
    swatch.dataset.colorIdx = i;
    swatch.addEventListener('click', function() {
      colorIndex = i;
      document.querySelectorAll('.guestbook-swatch').forEach(function(s, j) {
        s.setAttribute('aria-pressed', j === i ? 'true' : 'false');
      });
    });
    palette.appendChild(swatch);
  });
  editorDiv.appendChild(palette);

  canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  canvas.className = 'guestbook-drawing-canvas';
  canvas.style.width = Math.min(448, CANVAS_SIZE * 6) + 'px';
  canvas.style.height = Math.min(448, CANVAS_SIZE * 6) + 'px';
  canvas.setAttribute('tabindex', '0');
  ctx = canvas.getContext('2d');

  paintCanvas();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });

  editorDiv.appendChild(canvas);

  var saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'guestbook-command guestbook-save';
  saveBtn.textContent = currentEntry ? 'update entry' : 'sign guestbook';
  saveBtn.addEventListener('click', function() {
    if (onSave) onSave(pixels.slice(), saveBtn);
    else saveEntry(saveBtn);
  });
  editorDiv.appendChild(saveBtn);

  if (!onSave && currentEntry) {
    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'guestbook-command guestbook-delete';
    deleteBtn.textContent = 'delete my entry';
    deleteBtn.addEventListener('click', function() { deleteOwnEntry(deleteBtn); });
    editorDiv.appendChild(deleteBtn);
  }

  container.appendChild(editorDiv);
}

function makeIconBtn(icon, label, onClick) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'guestbook-icon-button';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = icon;
  btn.addEventListener('click', onClick);
  return btn;
}

function paintCanvas() {
  if (!ctx) return;
  var img = ctx.createImageData(CANVAS_SIZE, CANVAS_SIZE);
  for (var i = 0; i < pixels.length; i++) {
    var hex = PALETTE[pixels[i]] || PALETTE[0];
    var r = parseInt(hex.slice(1,3),16);
    var g = parseInt(hex.slice(3,5),16);
    var b = parseInt(hex.slice(5,7),16);
    img.data[i*4] = r;
    img.data[i*4+1] = g;
    img.data[i*4+2] = b;
    img.data[i*4+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function replaceCanvas(newPixels) {
  var before = pixels.slice();
  pixels = newPixels.slice();
  addHistory(before, pixels);
  paintCanvas();
}

function addHistory(before, after) {
  var eq = true;
  for (var i=0;i<before.length;i++) { if (before[i]!==after[i]){eq=false;break;} }
  if (eq) return;
  undoStack.push(before);
  if (undoStack.length > 60) undoStack.shift();
  redoStack = [];
  updateHistoryBtns();
}

function updateHistoryBtns() {
  var u = document.getElementById('gb-undo-btn');
  var r = document.getElementById('gb-redo-btn');
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}

function doUndo() {
  var prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(pixels.slice());
  pixels = prev;
  paintCanvas();
  updateHistoryBtns();
}

function doRedo() {
  var next = redoStack.pop();
  if (!next) return;
  undoStack.push(pixels.slice());
  pixels = next;
  paintCanvas();
  updateHistoryBtns();
}

function pointFromEvent(e) {
  var rect = canvas.getBoundingClientRect();
  var x = Math.max(0, Math.min(CANVAS_SIZE-1, Math.floor(((e.clientX-rect.left)/rect.width)*CANVAS_SIZE)));
  var y = Math.max(0, Math.min(CANVAS_SIZE-1, Math.floor(((e.clientY-rect.top)/rect.height)*CANVAS_SIZE)));
  return {x:x, y:y};
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  isDrawing = true;
  var pt = pointFromEvent(e);
  gestureBase = pixels.slice();
  gestureStart = pt;
  gestureLast = pt;

  var color = tool === 'eraser' ? BACKGROUND_INDEX : colorIndex;
  if (tool === 'fill') {
    var next = pixels.slice();
    floodFill(next, pt, color);
    var before = gestureBase;
    pixels = next;
    addHistory(before, pixels);
    paintCanvas();
    gestureBase = null;
    return;
  }
  if (tool === 'brush' || tool === 'eraser') {
    stamp(pixels, pt, color, brushSize);
    paintCanvas();
  } else if (tool === 'line') {
    var tmp = gestureBase.slice();
    drawLine(tmp, pt, pt, color, brushSize);
    pixels = tmp;
    paintCanvas();
  } else if (tool === 'circle') {
    var tmp2 = gestureBase.slice();
    drawCircle(tmp2, pt, pt, color, brushSize);
    pixels = tmp2;
    paintCanvas();
  }
}

function onPointerMove(e) {
  if (!isDrawing || !canvas.hasPointerCapture(e.pointerId)) return;
  e.preventDefault();
  var pt = pointFromEvent(e);
  var color = tool === 'eraser' ? BACKGROUND_INDEX : colorIndex;

  if (tool === 'brush' || tool === 'eraser') {
    drawLine(pixels, gestureLast, pt, color, brushSize);
    gestureLast = pt;
    paintCanvas();
  } else if (tool === 'line') {
    pixels = gestureBase.slice();
    drawLine(pixels, gestureStart, pt, color, brushSize);
    gestureLast = pt;
    paintCanvas();
  } else if (tool === 'circle') {
    pixels = gestureBase.slice();
    drawCircle(pixels, gestureStart, pt, color, brushSize);
    gestureLast = pt;
    paintCanvas();
  }
}

function onPointerUp(e) {
  if (!isDrawing) return;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  isDrawing = false;
  if (gestureBase) {
    addHistory(gestureBase, pixels);
    gestureBase = null;
  }
}

function pixelIndex(pt) { return pt.y * CANVAS_SIZE + pt.x; }
function inBounds(pt) { return pt.x>=0&&pt.x<CANVAS_SIZE&&pt.y>=0&&pt.y<CANVAS_SIZE; }

function stamp(px, pt, color, size) {
  var off = Math.floor((size-1)/2);
  for (var dy=0;dy<size;dy++) {
    for (var dx=0;dx<size;dx++) {
      var target = {x:pt.x+dx-off, y:pt.y+dy-off};
      if (inBounds(target)) px[pixelIndex(target)] = color;
    }
  }
}

function drawLine(px, a, b, color, size) {
  var dx = Math.abs(b.x-a.x), dy = Math.abs(b.y-a.y);
  var sx = a.x<b.x?1:-1, sy = a.y<b.y?1:-1;
  var err = dx-dy;
  var cx=a.x, cy=a.y;
  while (true) {
    stamp(px, {x:cx,y:cy}, color, size);
    if (cx===b.x && cy===b.y) break;
    var e2=2*err;
    if (e2>-dy){err-=dy;cx+=sx;}
    if (e2<dx){err+=dx;cy+=sy;}
  }
}

function drawCircle(px, a, b, color, size) {
  var cx=(a.x+b.x)/2, cy=(a.y+b.y)/2;
  var rx=Math.abs(b.x-a.x)/2, ry=Math.abs(b.y-a.y)/2;
  var steps = Math.ceil(2*Math.PI*Math.max(rx,ry));
  steps = Math.max(steps, 8);
  var prev = null;
  for (var i=0;i<=steps;i++) {
    var t = (i/steps)*2*Math.PI;
    var px2 = Math.round(cx+rx*Math.cos(t));
    var py2 = Math.round(cy+ry*Math.sin(t));
    var pt = {x:px2,y:py2};
    if (prev) drawLine(px, prev, pt, color, size);
    prev = pt;
  }
}

function floodFill(px, start, replacement) {
  var target = px[pixelIndex(start)];
  if (target === replacement) return;
  var queue = [pixelIndex(start)];
  px[pixelIndex(start)] = replacement;
  while (queue.length) {
    var idx = queue.shift();
    var x = idx % CANVAS_SIZE, y = Math.floor(idx / CANVAS_SIZE);
    [[x-1,y],[x+1,y],[x,y-1],[x,y+1]].forEach(function(nb) {
      var nx=nb[0],ny=nb[1];
      if (nx<0||nx>=CANVAS_SIZE||ny<0||ny>=CANVAS_SIZE) return;
      var ni = ny*CANVAS_SIZE+nx;
      if (px[ni]===target) { px[ni]=replacement; queue.push(ni); }
    });
  }
}

function saveEntry(btn) {
  btn.disabled = true;
  var encoded = encodePixels(pixels);
  var method = currentEntry ? 'PUT' : 'POST';
  fetch('/api/guestbook', {
    method: method,
    headers: {'content-type':'application/json'},
    body: JSON.stringify({pixels: Array.from(pixels)})
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.entry) {
      currentEntry = data.entry;
      var idx = entries.findIndex(function(e) { return e.id === data.entry.id; });
      if (idx >= 0) entries[idx] = data.entry; else entries.unshift(data.entry);
      renderAll();
    } else {
      alert(data.error || 'error saving entry');
      btn.disabled = false;
    }
  }).catch(function() { alert('network error'); btn.disabled = false; });
}

function deleteOwnEntry(btn) {
  if (!confirm('delete your guestbook entry?')) return;
  btn.disabled = true;
  fetch('/api/guestbook', {method:'DELETE'}).then(function(r) { return r.json(); }).then(function(data) {
    if (data.ok) {
      var deletedId = currentEntry ? currentEntry.id : null;
      currentEntry = null;
      if (deletedId !== null) entries = entries.filter(function(e) { return e.id !== deletedId; });
      renderAll();
    } else {
      alert(data.error || 'error deleting entry');
      btn.disabled = false;
    }
  }).catch(function() { alert('network error'); btn.disabled = false; });
}

function renderAdminMode() {
  var el = document.querySelector('.guestbook-admin-mode');
  if (!el) return;
  if (!siteAdmin) { el.style.display='none'; return; }
  el.style.display = '';
  var toggleBtn = el.querySelector('.admin-toggle-btn');
  if (toggleBtn) {
    toggleBtn.textContent = adminMode ? 'exit admin mode' : 'enter admin mode';
    toggleBtn.onclick = function() {
      adminMode = !adminMode;
      renderAll();
    };
  }
}

function renderBanList() {
  var el = document.querySelector('.guestbook-ban-list');
  if (!el) return;
  if (!siteAdmin) { el.style.display='none'; return; }
  el.style.display = '';
  var inner = el.querySelector('div');
  if (!inner) return;
  inner.innerHTML = '';
  if (!bans.length) {
    var empty = document.createElement('p');
    empty.textContent = 'no bans.';
    inner.appendChild(empty);
    return;
  }
  bans.forEach(function(ban) {
    var row = document.createElement('div');
    row.className = 'guestbook-ban-row';
    var span = document.createElement('span');
    span.textContent = ban.displayName + ' (@' + ban.username + ')';
    var unbanBtn = document.createElement('button');
    unbanBtn.type = 'button';
    unbanBtn.className = 'guestbook-command';
    unbanBtn.textContent = 'unban';
    unbanBtn.addEventListener('click', function() { adminUnban(ban.id); });
    row.appendChild(span);
    row.appendChild(unbanBtn);
    inner.appendChild(row);
  });
}

function startAdminEdit(entry) {
  adminEditingEntry = entry;
  var area = document.querySelector('.guestbook-admin-editor');
  if (!area) return;
  var heading = area.querySelector('.guestbook-admin-editor-heading');
  area.innerHTML = '';
  if (heading) area.appendChild(heading);
  else {
    var h = document.createElement('div');
    h.className = 'guestbook-admin-editor-heading';
    h.innerHTML = '<h3></h3>';
    area.appendChild(h);
    heading = h;
  }
  var h3 = heading.querySelector('h3');
  if (h3) h3.textContent = 'editing: ' + entry.displayName;
  area.style.display = '';
  initEditor(area, decodePixels(entry.pixels), function(px, btn) {
    btn.disabled = true;
    fetch('/api/guestbook/admin/entries/' + entry.id, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({pixels: Array.from(px)})
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.entry) {
        var idx = entries.findIndex(function(e) { return e.id === data.entry.id; });
        if (idx >= 0) entries[idx] = data.entry;
        area.style.display = 'none';
        adminEditingEntry = null;
        renderAll();
      } else {
        alert(data.error || 'error saving');
        btn.disabled = false;
      }
    }).catch(function() { alert('network error'); btn.disabled = false; });
  });
}

function adminDeleteEntry(entryId) {
  if (!confirm('delete this entry?')) return;
  fetch('/api/guestbook/admin/entries/'+entryId, {method:'DELETE'}).then(function(r){return r.json();}).then(function(data){
    if (data.ok) {
      entries = entries.filter(function(e){return e.id!==entryId;});
      renderAll();
    } else { alert(data.error||'error'); }
  }).catch(function(){alert('network error');});
}

function adminBan(entryId) {
  if (!confirm('ban this user?')) return;
  fetch('/api/guestbook/admin/bans', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({entryId:entryId})
  }).then(function(r){return r.json();}).then(function(data){
    if (data.ban) {
      bans.push(data.ban);
      var entry = entries.find(function(e){return e.id===entryId;});
      if (entry) entries = entries.filter(function(e){return e.id!==entryId;});
      renderAll();
    } else { alert(data.error||'error'); }
  }).catch(function(){alert('network error');});
}

function adminUnban(banId) {
  fetch('/api/guestbook/admin/bans/'+banId, {method:'DELETE'}).then(function(r){return r.json();}).then(function(data){
    if (data.ok) {
      bans = bans.filter(function(b){return b.id!==banId;});
      renderAll();
    } else { alert(data.error||'error'); }
  }).catch(function(){alert('network error');});
}

init();
})();
