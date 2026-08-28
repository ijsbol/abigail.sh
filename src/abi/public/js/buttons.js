(function() {
var BUTTON_W = 88, BUTTON_H = 31;
var PIXEL_COUNT = BUTTON_W * BUTTON_H;
var PIXEL_BYTES = PIXEL_COUNT * 2;
var ZOOM = 5;
var STORAGE_KEY = 'abigail.buttons.v2';
var LIB_COOKIE = 'abigail.buttons.v2';
var CHUNK_PREFIX = 'abigail.buttons.v2.';
var CHUNK_CHARS = 3800;
var HISTORY_LIMIT = 60;

var mode = {kind:'library'};
var lib = [];
var tool = 'brush';
var brushSize = 1;
var color = {r:255,g:105,b:180};
var prevColor = null;
var pixels = null;
var gestureBase = null;
var gestureStart = null;
var gestureLast = null;
var isDrawing = false;
var undoStack = [];
var redoStack = [];
var editorName = '';

importFromCookies();

function importFromCookies() {
  try {
    var libCookie = readCookie(LIB_COOKIE);
    if (!libCookie) return;
    var parsed = JSON.parse(libCookie);
    if (!parsed || parsed.version !== 2 || !Array.isArray(parsed.items)) return;
    var imported = 0;
    parsed.items.forEach(function(meta) {
      var combined = '';
      for (var n=0;n<9;n++) {
        var chunk = readCookie(CHUNK_PREFIX + meta.id + '.' + n);
        if (chunk === null) break;
        combined += chunk;
      }
      if (!combined) return;
      try {
        var bytes = base64ToBytes(combined);
        if (bytes.length !== PIXEL_BYTES) return;
        var existing = lsGetLib();
        if (!existing.find(function(r){return r.id===meta.id;})) {
          lsSaveButton({id:meta.id,name:meta.name,updatedAt:meta.updatedAt}, bytes);
          imported++;
        }
        clearCookieChunks(meta.id);
      } catch(e) {}
    });
    if (imported > 0) clearCookie(LIB_COOKIE);
  } catch(e) {}
}

function readCookie(name) {
  var all = '; ' + document.cookie;
  var prefix = '; ' + name + '=';
  var start = all.indexOf(prefix);
  if (start === -1) return null;
  var end = all.indexOf(';', start + prefix.length);
  return decodeURIComponent(all.slice(start + prefix.length, end === -1 ? undefined : end));
}

function clearCookie(name) {
  document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax';
}

function clearCookieChunks(id) {
  for (var n=0;n<9;n++) {
    var name = CHUNK_PREFIX + id + '.' + n;
    if (readCookie(name) === null) break;
    clearCookie(name);
  }
}

var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64ToBytes(b64) {
  var s = b64.replace(/=+$/,'');
  var lookup = new Int8Array(256).fill(-1);
  for (var i=0;i<B64.length;i++) lookup[B64.charCodeAt(i)]=i;
  var len = Math.floor(s.length*3/4);
  var out = new Uint8Array(len);
  var p=0;
  for (var i=0;i<s.length;i+=4) {
    var c0=lookup[s.charCodeAt(i)],c1=lookup[s.charCodeAt(i+1)];
    var c2=i+2<s.length?lookup[s.charCodeAt(i+2)]:0;
    var c3=i+3<s.length?lookup[s.charCodeAt(i+3)]:0;
    if(p<len) out[p++]=(c0<<2)|(c1>>4);
    if(p<len) out[p++]=((c1&15)<<4)|(c2>>2);
    if(p<len) out[p++]=((c2&3)<<6)|c3;
  }
  return out;
}

function bytesToBase64(bytes) {
  var out='', n=bytes.length;
  for (var i=0;i<n;i+=3) {
    var b0=bytes[i],b1=i+1<n?bytes[i+1]:0,b2=i+2<n?bytes[i+2]:0;
    out+=B64[b0>>2];out+=B64[((b0&3)<<4)|(b1>>4)];
    out+=i+1<n?B64[((b1&15)<<2)|(b2>>6)]:'=';
    out+=i+2<n?B64[b2&63]:'=';
  }
  return out;
}

function lsGetLib() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    var items = (parsed && parsed.items) || [];
    var result = [];
    items.forEach(function(meta) {
      var pixStr = localStorage.getItem(STORAGE_KEY + ':pixels:' + meta.id);
      if (!pixStr) return;
      try {
        var bytes = base64ToBytes(pixStr);
        if (bytes.length !== PIXEL_BYTES) return;
        result.push({id:meta.id,name:meta.name,updatedAt:meta.updatedAt,pixels:bytes});
      } catch(e) {}
    });
    return result;
  } catch(e) { return []; }
}

function lsSaveButton(meta, bytes) {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    var parsed = raw ? JSON.parse(raw) : {version:2,items:[]};
    var items = (parsed && parsed.items) || [];
    var idx = items.findIndex(function(m){return m.id===meta.id;});
    if (idx>=0) items[idx]={id:meta.id,name:meta.name,updatedAt:meta.updatedAt};
    else items.push({id:meta.id,name:meta.name,updatedAt:meta.updatedAt});
    localStorage.setItem(STORAGE_KEY, JSON.stringify({version:2,items:items}));
    localStorage.setItem(STORAGE_KEY+':pixels:'+meta.id, bytesToBase64(bytes));
  } catch(e) {}
}

function lsDeleteButton(id) {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    var parsed = JSON.parse(raw);
    parsed.items = (parsed.items||[]).filter(function(m){return m.id!==id;});
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    localStorage.removeItem(STORAGE_KEY+':pixels:'+id);
  } catch(e) {}
}

function newId() {
  var r = new Uint8Array(12);
  crypto.getRandomValues(r);
  return Array.from(r,function(b){return b.toString(16).padStart(2,'0');}).join('');
}

function readPixel(buf, x, y) {
  var i=(y*BUTTON_W+x)*2;
  return buf[i]|(buf[i+1]<<8);
}

function writePixel(buf, x, y, val) {
  var i=(y*BUTTON_W+x)*2;
  buf[i]=val&0xff; buf[i+1]=(val>>8)&0xff;
}

function emptyPixels() { return new Uint8Array(PIXEL_BYTES); }

function rgb565(r,g,b) {
  return ((r>>3)<<11)|((g>>2)<<5)|(b>>3);
}

function rgb565ToHex(p) {
  var r5=(p>>11)&31, g6=(p>>5)&63, b5=p&31;
  var r=(r5<<3)|(r5>>2), g=(g6<<2)|(g6>>4), b=(b5<<3)|(b5>>2);
  return '#'+[r,g,b].map(function(v){return v.toString(16).padStart(2,'0');}).join('');
}

function colorTo565(c) { return rgb565(c.r,c.g,c.b); }

var currentCanvas = null;
var currentCtx = null;

function renderCanvas(cvs, buf) {
  var c = cvs.getContext('2d');
  if (!c) return;
  c.imageSmoothingEnabled = false;
  for (var y=0;y<BUTTON_H;y++) {
    for (var x=0;x<BUTTON_W;x++) {
      c.fillStyle = rgb565ToHex(readPixel(buf,x,y));
      c.fillRect(x,y,1,1);
    }
  }
}

function main() {
  lib = lsGetLib();
  render();
}

function render() {
  var root = document.querySelector('.btn-page');
  if (!root) return;
  root.innerHTML = '';

  if (mode.kind === 'library') {
    renderLibrary(root);
  } else {
    renderEditor(root);
  }
}

function renderLibrary(root) {
  var desc = document.createElement('p');
  desc.textContent = "a nice 'lil 88x31 button editor. all of your buttons live in your browser's localStorage, this website does not store anything on a server.";
  root.appendChild(desc);

  var actions = document.createElement('div');
  actions.className = 'btn-library-actions';
  var newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'btn-primary';
  newBtn.textContent = '+ new button';
  newBtn.addEventListener('click', function() {
    mode = {kind:'create'};
    editorName = 'untitled';
    pixels = emptyPixels();
    undoStack=[];redoStack=[];
    render();
  });
  actions.appendChild(newBtn);
  root.appendChild(actions);

  if (lib.length > 0) {
    var grid = document.createElement('div');
    grid.className = 'btn-library';
    lib.forEach(function(rec) {
      grid.appendChild(makeCard(rec));
    });
    root.appendChild(grid);
  } else {
    var hint = document.createElement('span');
    hint.className = 'btn-hint';
    hint.textContent = 'no saved buttons yet. create one to start.';
    root.appendChild(hint);
  }

  var footer = document.createElement('p');
  footer.className = 'btn-footer';
  footer.textContent = 'tip: localStorage is tied to this browser. opening this page on a different device starts a fresh library.';
  root.appendChild(footer);
}

function makeCard(rec) {
  var card = document.createElement('div');
  card.className = 'btn-card';

  var thumb = document.createElement('canvas');
  thumb.width = BUTTON_W;
  thumb.height = BUTTON_H;
  thumb.className = 'btn-thumb';
  thumb.setAttribute('aria-label', rec.name);
  thumb.setAttribute('role', 'img');
  thumb.style.width = BUTTON_W*2+'px';
  thumb.style.height = BUTTON_H*2+'px';
  thumb.style.imageRendering = 'pixelated';
  renderCanvas(thumb, rec.pixels);
  card.appendChild(thumb);

  var meta = document.createElement('div');
  meta.className = 'btn-card-meta';
  var nameDiv = document.createElement('div');
  nameDiv.className = 'btn-card-name';
  nameDiv.textContent = rec.name;
  var dateDiv = document.createElement('div');
  dateDiv.className = 'btn-card-date';
  dateDiv.textContent = new Date(rec.updatedAt).toLocaleString();
  meta.appendChild(nameDiv);
  meta.appendChild(dateDiv);
  card.appendChild(meta);

  var acts = document.createElement('div');
  acts.className = 'btn-card-actions';
  var editBtn = makeCardBtn('edit', function() {
    mode = {kind:'edit',id:rec.id,name:rec.name};
    editorName = rec.name;
    pixels = new Uint8Array(rec.pixels);
    undoStack=[];redoStack=[];
    render();
  });
  var dupBtn = makeCardBtn('duplicate', function() {
    mode = {kind:'duplicate',source:rec};
    editorName = rec.name + ' copy';
    pixels = new Uint8Array(rec.pixels);
    undoStack=[];redoStack=[];
    render();
  });
  var exportBtn = makeCardBtn('export', function() {
    exportPng(rec.pixels, (rec.name||'button')+'.png');
  });
  var delBtn = makeCardBtn('delete', function() {
    if (!confirm('delete "'+rec.name+'"?')) return;
    lsDeleteButton(rec.id);
    lib = lsGetLib();
    render();
  });
  delBtn.className = 'btn-card-delete';
  acts.appendChild(editBtn);
  acts.appendChild(dupBtn);
  acts.appendChild(exportBtn);
  acts.appendChild(delBtn);
  card.appendChild(acts);
  return card;
}

function makeCardBtn(text, onClick) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

function renderEditor(root) {
  var isEdit = mode.kind === 'edit';
  var isDup = mode.kind === 'duplicate';
  var desc = document.createElement('p');
  desc.textContent = 'painting an 88x31 button. upload an image and the colours snap to the 16-bit picker; draw with brush / eraser / line / circle / fill and adjust brush size as needed.';
  root.appendChild(desc);

  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'btn-editor-name';
  nameInput.value = editorName;
  nameInput.placeholder = 'button name';
  nameInput.maxLength = 64;
  nameInput.setAttribute('aria-label', 'button name');
  nameInput.addEventListener('input', function() { editorName = nameInput.value; });
  root.appendChild(nameInput);

  var editorDiv = document.createElement('div');
  editorDiv.className = 'btn-editor';

  var toolbar = document.createElement('div');
  toolbar.className = 'btn-editor-toolbar';
  toolbar.setAttribute('aria-label', 'drawing tools');

  var toolGroup = document.createElement('div');
  toolGroup.className = 'btn-editor-tool-group';

  var tools = [
    {id:'brush',label:'Brush',icon:'B'},
    {id:'eraser',label:'Eraser',icon:'E'},
    {id:'line',label:'Line',icon:'L'},
    {id:'circle',label:'Circle',icon:'O'},
    {id:'fill',label:'Fill',icon:'F'},
    {id:'picker',label:'Eyedropper',icon:'I'}
  ];

  tools.forEach(function(t) {
    var btn = document.createElement('button');
    btn.type='button';
    btn.className='btn-editor-icon'+(tool===t.id?' is-active':'');
    btn.setAttribute('aria-label',t.label);
    btn.setAttribute('aria-pressed',tool===t.id?'true':'false');
    btn.title=t.label;
    btn.textContent=t.icon;
    btn.dataset.toolId=t.id;
    btn.addEventListener('click',function(){
      tool=t.id;
      document.querySelectorAll('[data-tool-id]').forEach(function(b){
        var active=b.dataset.toolId===tool;
        b.classList.toggle('is-active',active);
        b.setAttribute('aria-pressed',String(active));
      });
    });
    toolGroup.appendChild(btn);
  });

  var histGroup = document.createElement('div');
  histGroup.className = 'btn-editor-tool-group';

  var undoBtn = makeEditorIconBtn('U','Undo',function(){doEditorUndo();});
  var redoBtn = makeEditorIconBtn('R','Redo',function(){doEditorRedo();});
  var restoreBtn = makeEditorIconBtn('↺','Restore saved',function(){
    var orig = isEdit ? lib.find(function(r){return r.id===mode.id;}) : null;
    replaceEditorCanvas(orig ? new Uint8Array(orig.pixels) : emptyPixels());
  });
  var clearBtn = makeEditorIconBtn('✕','Clear',function(){replaceEditorCanvas(emptyPixels());});
  var uploadBtn = makeEditorIconBtn('↑','Upload image',function(){fileInput.click();});
  uploadBtn.textContent='upload';
  uploadBtn.style.width='auto';
  uploadBtn.style.padding='0 8px';

  undoBtn.id='btn-undo';redoBtn.id='btn-redo';
  undoBtn.disabled=true;redoBtn.disabled=true;

  var fileInput = document.createElement('input');
  fileInput.type='file';fileInput.accept='image/*';fileInput.style.display='none';
  fileInput.addEventListener('change',function(e){
    var file=e.target.files&&e.target.files[0];
    if(!file) return;
    importImage(file,function(newPixels,err){
      if(err){var errEl=root.querySelector('.btn-error');if(errEl)errEl.textContent='import failed: '+err;}
      else replaceEditorCanvas(newPixels);
    });
    fileInput.value='';
  });

  histGroup.appendChild(undoBtn);histGroup.appendChild(redoBtn);
  histGroup.appendChild(restoreBtn);histGroup.appendChild(clearBtn);
  histGroup.appendChild(uploadBtn);histGroup.appendChild(fileInput);

  var sizeCtrl = document.createElement('label');
  sizeCtrl.className='btn-editor-size-control';
  sizeCtrl.innerHTML='<span>brush</span><input type="range" min="1" max="4" value="'+brushSize+'"><output>'+brushSize+'</output>';
  var sizeInput=sizeCtrl.querySelector('input');
  var sizeOutput=sizeCtrl.querySelector('output');
  sizeInput.addEventListener('input',function(){brushSize=parseInt(sizeInput.value,10);sizeOutput.value=brushSize;});

  toolbar.appendChild(toolGroup);toolbar.appendChild(histGroup);toolbar.appendChild(sizeCtrl);
  editorDiv.appendChild(toolbar);

  var stage = document.createElement('div');
  stage.className='btn-editor-stage';

  var canvasWrap = document.createElement('div');
  canvasWrap.className='btn-editor-canvas-wrap';
  canvasWrap.style.width=BUTTON_W*ZOOM+'px';
  canvasWrap.style.height=BUTTON_H*ZOOM+'px';

  currentCanvas = document.createElement('canvas');
  currentCanvas.width=BUTTON_W;currentCanvas.height=BUTTON_H;
  currentCanvas.className='btn-editor-canvas';
  currentCtx=currentCanvas.getContext('2d');
  repaintEditorCanvas();

  currentCanvas.addEventListener('pointerdown',onEditorPointerDown);
  currentCanvas.addEventListener('pointermove',onEditorPointerMove);
  currentCanvas.addEventListener('pointerup',onEditorPointerUp);
  currentCanvas.addEventListener('pointercancel',onEditorPointerUp);
  currentCanvas.addEventListener('contextmenu',function(e){e.preventDefault();});

  var grid = document.createElement('div');
  grid.className='btn-editor-grid';

  canvasWrap.appendChild(currentCanvas);canvasWrap.appendChild(grid);
  stage.appendChild(canvasWrap);

  var pickerPanel=document.createElement('div');
  pickerPanel.className='btn-editor-palette';
  appendColorPicker(pickerPanel);
  stage.appendChild(pickerPanel);
  editorDiv.appendChild(stage);

  var errEl=document.createElement('p');errEl.className='btn-error';errEl.style.display='none';
  editorDiv.appendChild(errEl);

  var acts=document.createElement('div');
  acts.className='btn-editor-actions';
  var cancelBtn=document.createElement('button');
  cancelBtn.type='button';cancelBtn.className='btn-editor-cancel';cancelBtn.textContent='cancel';
  cancelBtn.addEventListener('click',function(){mode={kind:'library'};lib=lsGetLib();render();});
  var exportPngBtn=document.createElement('button');
  exportPngBtn.type='button';exportPngBtn.className='btn-editor-export';exportPngBtn.textContent='export png';
  exportPngBtn.addEventListener('click',function(){exportPng(pixels,(editorName||'button')+'.png');});
  var saveBtn=document.createElement('button');
  saveBtn.type='button';saveBtn.className='btn-editor-save';saveBtn.textContent='save';
  saveBtn.addEventListener('click',function(){
    var id=isEdit?mode.id:newId();
    var name=(editorName||'untitled').trim()||'untitled';
    lsSaveButton({id:id,name:name,updatedAt:Date.now()},pixels);
    lib=lsGetLib();mode={kind:'library'};render();
  });
  acts.appendChild(cancelBtn);acts.appendChild(exportPngBtn);acts.appendChild(saveBtn);
  editorDiv.appendChild(acts);
  root.appendChild(editorDiv);
}

function makeEditorIconBtn(icon,label,onClick) {
  var btn=document.createElement('button');
  btn.type='button';btn.className='btn-editor-icon';
  btn.setAttribute('aria-label',label);btn.title=label;btn.textContent=icon;
  btn.addEventListener('click',onClick);
  return btn;
}

function repaintEditorCanvas() {
  if(!currentCtx||!pixels) return;
  currentCtx.imageSmoothingEnabled=false;
  for(var y=0;y<BUTTON_H;y++){
    for(var x=0;x<BUTTON_W;x++){
      currentCtx.fillStyle=rgb565ToHex(readPixel(pixels,x,y));
      currentCtx.fillRect(x,y,1,1);
    }
  }
}

function replaceEditorCanvas(newPixels) {
  var before=new Uint8Array(pixels);
  pixels=new Uint8Array(newPixels);
  addEditorHistory(before);
  repaintEditorCanvas();
}

function addEditorHistory(before) {
  undoStack.push(before);
  if(undoStack.length>HISTORY_LIMIT) undoStack.shift();
  redoStack=[];
  updateEditorHistoryBtns();
}

function updateEditorHistoryBtns() {
  var u=document.getElementById('btn-undo');
  var r=document.getElementById('btn-redo');
  if(u) u.disabled=undoStack.length===0;
  if(r) r.disabled=redoStack.length===0;
}

function doEditorUndo() {
  var prev=undoStack.pop();
  if(!prev) return;
  redoStack.push(new Uint8Array(pixels));
  pixels=prev;repaintEditorCanvas();updateEditorHistoryBtns();
}

function doEditorRedo() {
  var next=redoStack.pop();
  if(!next) return;
  undoStack.push(new Uint8Array(pixels));
  pixels=next;repaintEditorCanvas();updateEditorHistoryBtns();
}

function pointFromEditorEvent(e) {
  var rect=currentCanvas.getBoundingClientRect();
  var x=Math.max(0,Math.min(BUTTON_W-1,Math.floor(((e.clientX-rect.left)/rect.width)*BUTTON_W)));
  var y=Math.max(0,Math.min(BUTTON_H-1,Math.floor(((e.clientY-rect.top)/rect.height)*BUTTON_H)));
  return {x:x,y:y};
}

function onEditorPointerDown(e) {
  if(e.button!==0) return;
  e.preventDefault();currentCanvas.setPointerCapture(e.pointerId);
  isDrawing=true;
  var pt=pointFromEditorEvent(e);
  gestureBase=new Uint8Array(pixels);
  gestureStart=pt;gestureLast=pt;

  if(tool==='picker') {
    var val=readPixel(pixels,pt.x,pt.y);
    var r5=(val>>11)&31,g6=(val>>5)&63,b5=val&31;
    prevColor=color;
    color={r:(r5<<3)|(r5>>2),g:(g6<<2)|(g6>>4),b:(b5<<3)|(b5>>2)};
    updatePickerDisplay();
    isDrawing=false;gestureBase=null;return;
  }

  var col=tool==='eraser'?0:colorTo565(color);
  if(tool==='fill') {
    var next=new Uint8Array(pixels);
    editorFloodFill(next,pt,col);
    pixels=next;addEditorHistory(gestureBase);gestureBase=null;
    repaintEditorCanvas();isDrawing=false;return;
  }
  if(tool==='brush'||tool==='eraser'){editorStamp(pixels,pt,col,brushSize);}
  else if(tool==='line'){var t=new Uint8Array(gestureBase);editorDrawLine(t,pt,pt,col,brushSize);pixels=t;}
  else if(tool==='circle'){var t2=new Uint8Array(gestureBase);editorDrawCircle(t2,pt,pt,col,brushSize);pixels=t2;}
  repaintEditorCanvas();
}

function onEditorPointerMove(e) {
  if(!isDrawing||!currentCanvas.hasPointerCapture(e.pointerId)) return;
  e.preventDefault();
  var pt=pointFromEditorEvent(e);
  var col=tool==='eraser'?0:colorTo565(color);
  if(tool==='brush'||tool==='eraser'){editorDrawLine(pixels,gestureLast,pt,col,brushSize);gestureLast=pt;}
  else if(tool==='line'){pixels=new Uint8Array(gestureBase);editorDrawLine(pixels,gestureStart,pt,col,brushSize);gestureLast=pt;}
  else if(tool==='circle'){pixels=new Uint8Array(gestureBase);editorDrawCircle(pixels,gestureStart,pt,col,brushSize);gestureLast=pt;}
  repaintEditorCanvas();
}

function onEditorPointerUp(e) {
  if(!isDrawing) return;
  if(currentCanvas.hasPointerCapture(e.pointerId)) currentCanvas.releasePointerCapture(e.pointerId);
  isDrawing=false;
  if(gestureBase){addEditorHistory(gestureBase);gestureBase=null;}
}

function editorStamp(buf,pt,col,size) {
  var off=Math.floor((size-1)/2);
  for(var dy=0;dy<size;dy++){for(var dx=0;dx<size;dx++){
    var tx=pt.x+dx-off,ty=pt.y+dy-off;
    if(tx>=0&&tx<BUTTON_W&&ty>=0&&ty<BUTTON_H) writePixel(buf,tx,ty,col);
  }}
}

function editorDrawLine(buf,a,b,col,size) {
  var dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y);
  var sx=a.x<b.x?1:-1,sy=a.y<b.y?1:-1,err=dx-dy,cx=a.x,cy=a.y;
  while(true){
    editorStamp(buf,{x:cx,y:cy},col,size);
    if(cx===b.x&&cy===b.y) break;
    var e2=2*err;if(e2>-dy){err-=dy;cx+=sx;}if(e2<dx){err+=dx;cy+=sy;}
  }
}

function editorDrawCircle(buf,a,b,col,size) {
  var cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,rx=Math.abs(b.x-a.x)/2,ry=Math.abs(b.y-a.y)/2;
  var steps=Math.max(8,Math.ceil(2*Math.PI*Math.max(rx,ry)));
  var prev=null;
  for(var i=0;i<=steps;i++){
    var t=(i/steps)*2*Math.PI;
    var px2=Math.round(cx+rx*Math.cos(t)),py2=Math.round(cy+ry*Math.sin(t));
    var pt={x:px2,y:py2};
    if(prev) editorDrawLine(buf,prev,pt,col,size);
    prev=pt;
  }
}

function editorFloodFill(buf,start,replacement) {
  var si=(start.y*BUTTON_W+start.x)*2;
  var target=buf[si]|(buf[si+1]<<8);
  if(target===replacement) return;
  var queue=[[start.x,start.y]];
  writePixel(buf,start.x,start.y,replacement);
  while(queue.length){
    var p=queue.shift();var x=p[0],y=p[1];
    [[x-1,y],[x+1,y],[x,y-1],[x,y+1]].forEach(function(nb){
      var nx=nb[0],ny=nb[1];
      if(nx<0||nx>=BUTTON_W||ny<0||ny>=BUTTON_H) return;
      var cur=readPixel(buf,nx,ny);
      if(cur===target){writePixel(buf,nx,ny,replacement);queue.push([nx,ny]);}
    });
  }
}

function exportPng(buf,filename) {
  var cvs=document.createElement('canvas');cvs.width=BUTTON_W;cvs.height=BUTTON_H;
  var c=cvs.getContext('2d');if(!c) return;
  c.imageSmoothingEnabled=false;
  for(var y=0;y<BUTTON_H;y++){for(var x=0;x<BUTTON_W;x++){
    c.fillStyle=rgb565ToHex(readPixel(buf,x,y));c.fillRect(x,y,1,1);
  }}
  cvs.toBlob(function(blob){
    if(!blob) return;
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');a.href=url;a.download=filename;
    document.body.appendChild(a);a.click();a.remove();
    URL.revokeObjectURL(url);
  },'image/png');
}

function importImage(file,cb) {
  var img=new Image();
  var url=URL.createObjectURL(file);
  img.onload=function(){
    URL.revokeObjectURL(url);
    var cvs=document.createElement('canvas');cvs.width=BUTTON_W;cvs.height=BUTTON_H;
    var c=cvs.getContext('2d');if(!c){cb(null,'no canvas');return;}
    c.drawImage(img,0,0,BUTTON_W,BUTTON_H);
    var data=c.getImageData(0,0,BUTTON_W,BUTTON_H).data;
    var newBuf=new Uint8Array(PIXEL_BYTES);
    for(var i=0;i<PIXEL_COUNT;i++){
      var r=data[i*4],g=data[i*4+1],b=data[i*4+2];
      writePixel(newBuf,i%BUTTON_W,Math.floor(i/BUTTON_W),rgb565(r,g,b));
    }
    cb(newBuf,null);
  };
  img.onerror=function(){URL.revokeObjectURL(url);cb(null,'could not load image');};
  img.src=url;
}

var hsvH=0,hsvS=100,hsvV=100;

function hsvToRgb(h,s,v) {
  var sn=s/100,vn=v/100,c=vn*sn,hh=(h%360)/60,x=c*(1-Math.abs(hh%2-1));
  var r1=0,g1=0,b1=0;
  if(hh<1){r1=c;g1=x;}else if(hh<2){r1=x;g1=c;}else if(hh<3){g1=c;b1=x;}
  else if(hh<4){g1=x;b1=c;}else if(hh<5){r1=x;b1=c;}else{r1=c;b1=x;}
  var m=vn-c;
  return {r:Math.round((r1+m)*255),g:Math.round((g1+m)*255),b:Math.round((b1+m)*255)};
}

function rgbToHsv(r,g,b) {
  var rn=r/255,gn=g/255,bn=b/255;
  var max=Math.max(rn,gn,bn),min=Math.min(rn,gn,bn),delta=max-min;
  var h=0;
  if(delta){
    if(max===rn) h=((gn-bn)/delta)%6;
    else if(max===gn) h=(bn-rn)/delta+2;
    else h=(rn-gn)/delta+4;
    h*=60;if(h<0)h+=360;
  }
  return {h:h,s:max?delta/max*100:0,v:max*100};
}

function updatePickerDisplay() {
  var hsv=rgbToHsv(color.r,color.g,color.b);
  hsvH=hsv.h;hsvS=hsv.s;hsvV=hsv.v;
  var svEl=document.querySelector('.btn-picker-sv');
  var hueCur=document.querySelector('.btn-picker-hue-cursor');
  var svCur=document.querySelector('.btn-picker-cursor');
  var swatchEl=document.querySelector('.btn-picker-swatch');
  var hexEl=document.querySelector('.btn-picker-hex');
  var rIn=document.querySelector('.btn-picker-r');
  var gIn=document.querySelector('.btn-picker-g');
  var bIn=document.querySelector('.btn-picker-b');
  var hex=rgbToHex(color);
  if(svEl) svEl.style.background='linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl('+hsvH+',100%,50%))';
  if(hueCur) hueCur.style.left=(hsvH/360*100)+'%';
  if(svCur){svCur.style.left=hsvS+'%';svCur.style.top=(100-hsvV)+'%';svCur.style.background=hex;}
  if(swatchEl) swatchEl.style.background=hex;
  if(hexEl) hexEl.textContent=hex;
  if(rIn) rIn.value=color.r;
  if(gIn) gIn.value=color.g;
  if(bIn) bIn.value=color.b;
  var prevSwatch=document.querySelector('.btn-picker-previous');
  if(prevSwatch && prevColor) prevSwatch.style.background=rgbToHex(prevColor);
  else if(prevSwatch) prevSwatch.style.display='none';
}

function rgbToHex(c) {
  return '#'+[c.r,c.g,c.b].map(function(v){return Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0');}).join('');
}

function appendColorPicker(parent) {
  var hsv=rgbToHsv(color.r,color.g,color.b);
  hsvH=hsv.h;hsvS=hsv.s;hsvV=hsv.v;

  var picker=document.createElement('div');
  picker.className='btn-picker';

  var svDiv=document.createElement('div');
  svDiv.className='btn-picker-sv';
  svDiv.style.width='200px';svDiv.style.height='200px';
  svDiv.style.background='linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl('+hsvH+',100%,50%))';
  svDiv.setAttribute('role','slider');svDiv.setAttribute('aria-label','saturation and value');

  var svCur=document.createElement('div');
  svCur.className='btn-picker-cursor';
  svCur.style.left=hsvS+'%';svCur.style.top=(100-hsvV)+'%';svCur.style.background=rgbToHex(color);
  svDiv.appendChild(svCur);

  addPointerHandler(svDiv,function(e){
    var rect=svDiv.getBoundingClientRect();
    var ns=Math.max(0,Math.min(100,((e.clientX-rect.left)/rect.width)*100));
    var nv=Math.max(0,Math.min(100,100-((e.clientY-rect.top)/rect.height)*100));
    hsvS=ns;hsvV=nv;
    var rgb=hsvToRgb(hsvH,hsvS,hsvV);
    prevColor=color;color=rgb;updatePickerDisplay();
  });

  var hueBar=document.createElement('div');
  hueBar.className='btn-picker-hue';hueBar.style.height='14px';
  hueBar.setAttribute('role','slider');hueBar.setAttribute('aria-label','hue');
  var hueCur=document.createElement('div');
  hueCur.className='btn-picker-hue-cursor';
  hueCur.style.left=(hsvH/360*100)+'%';
  hueBar.appendChild(hueCur);

  addPointerHandler(hueBar,function(e){
    var rect=hueBar.getBoundingClientRect();
    hsvH=Math.max(0,Math.min(360,((e.clientX-rect.left)/rect.width)*360));
    var rgb=hsvToRgb(hsvH,hsvS,hsvV);
    prevColor=color;color=rgb;updatePickerDisplay();
  });

  var readout=document.createElement('div');readout.className='btn-picker-readout';
  var curDiv=document.createElement('div');curDiv.className='btn-picker-current';
  var swatchSpan=document.createElement('span');swatchSpan.className='btn-picker-swatch';swatchSpan.style.background=rgbToHex(color);
  var hexCode=document.createElement('code');hexCode.className='btn-picker-hex';hexCode.textContent=rgbToHex(color);
  curDiv.appendChild(swatchSpan);curDiv.appendChild(hexCode);readout.appendChild(curDiv);

  if(prevColor) {
    var prevBtn=document.createElement('button');prevBtn.type='button';
    prevBtn.className='btn-picker-previous';prevBtn.style.background=rgbToHex(prevColor);
    prevBtn.title='restore previous colour';prevBtn.setAttribute('aria-label','restore previous colour');
    prevBtn.addEventListener('click',function(){color=prevColor;updatePickerDisplay();});
    readout.appendChild(prevBtn);
  }

  var rgbDiv=document.createElement('div');rgbDiv.className='btn-picker-rgb';
  function makeRgbInput(label,val,key) {
    var lbl=document.createElement('label');
    var span=document.createElement('span');span.textContent=label;
    var inp=document.createElement('input');inp.type='number';inp.min=0;inp.max=255;
    inp.value=val;inp.size=3;inp.className='btn-picker-'+label.toLowerCase();
    inp.addEventListener('change',function(){
      var n=Math.max(0,Math.min(255,parseInt(inp.value,10)||0));
      color[key]=n;prevColor=color;updatePickerDisplay();
    });
    lbl.appendChild(span);lbl.appendChild(inp);return lbl;
  }
  rgbDiv.appendChild(makeRgbInput('R',color.r,'r'));
  rgbDiv.appendChild(makeRgbInput('G',color.g,'g'));
  rgbDiv.appendChild(makeRgbInput('B',color.b,'b'));

  picker.appendChild(svDiv);picker.appendChild(hueBar);picker.appendChild(readout);picker.appendChild(rgbDiv);
  parent.appendChild(picker);
}

function addPointerHandler(el,handler) {
  el.addEventListener('pointerdown',function(e){
    e.preventDefault();el.setPointerCapture(e.pointerId);handler(e);
  });
  el.addEventListener('pointermove',function(e){
    if(!el.hasPointerCapture(e.pointerId)) return;
    e.preventDefault();handler(e);
  });
  el.addEventListener('pointerup',function(e){el.releasePointerCapture(e.pointerId);});
}

main();
})();
