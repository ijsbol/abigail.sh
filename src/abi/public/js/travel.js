(function() {
var geo = window.__TRAVEL_GEO__;
var statusByNum = window.__TRAVEL_STATUS_BY_NUM__;
var nextTrip = window.__TRAVEL_NEXT_TRIP__;

if (!geo) return;

var W = geo.width;
var H = geo.height;
var MIN_SCALE = 1;
var MAX_SCALE = 9;

var STATUS_CLASS = {next:'c-next',current:'c-current',visited:'c-visited',passed:'c-passed'};
var STATUS_LABELS = {next:'up next',current:'currently in',visited:'visited',passed:'passed through'};

var svg = document.querySelector('.world-map-svg');
var mapEl = document.querySelector('.world-map');
var group = document.querySelector('.world-map-svg g');
if (!svg || !group) return;

var view = {scale:1,x:0,y:0};
var panning = false;
var animating = false;
var hover = null;
var pointers = {};
var pinchDist = 0;
var moved = false;

function clampView(s, x, y) {
  s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  x = Math.min(0, Math.max(W * (1 - s), x));
  y = Math.min(0, Math.max(H * (1 - s), y));
  return {scale:s, x:x, y:y};
}

function applyView(anim) {
  if (anim) {
    group.classList.add('map-zoom-anim');
    setTimeout(function() { group.classList.remove('map-zoom-anim'); }, 520);
  } else {
    group.classList.remove('map-zoom-anim');
  }
  group.setAttribute('transform', 'translate('+view.x+' '+view.y+') scale('+view.scale+')');
  var resetBtn = document.querySelector('.map-reset-btn');
  if (resetBtn) resetBtn.disabled = (view.scale===1 && view.x===0 && view.y===0);
}

function toSvgCoords(clientX, clientY) {
  var rect = svg.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * W,
    y: ((clientY - rect.top) / rect.height) * H
  };
}

function zoomAt(svgX, svgY, factor) {
  var newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  var dx = svgX * (view.scale - newScale);
  var dy = svgY * (view.scale - newScale);
  var v = clampView(newScale, view.x + dx, view.y + dy);
  view.scale = v.scale; view.x = v.x; view.y = v.y;
  applyView(false);
}

function focusOnRegion(num) {
  var bounds = geo.bounds;
  var key = String(num);
  if (!bounds[key]) return;
  var b = bounds[key];
  var bx0=b[0], by0=b[1], bx1=b[2], by1=b[3];
  var bw = bx1-bx0, bh = by1-by0;
  if (bw<1) bw=1; if (bh<1) bh=1;
  var pad = 40;
  var scaleX = (W - pad*2) / bw;
  var scaleY = (H - pad*2) / bh;
  var newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(scaleX, scaleY)));
  var cx = (bx0+bx1)/2, cy = (by0+by1)/2;
  var newX = W/2 - cx * newScale;
  var newY = H/2 - cy * newScale;
  var v = clampView(newScale, newX, newY);
  view.scale = v.scale; view.x = v.x; view.y = v.y;
  applyView(true);
}

svg.addEventListener('pointerdown', function(e) {
  pointers[e.pointerId] = {x:e.clientX, y:e.clientY};
  moved = false;
  if (Object.keys(pointers).length === 1) {
    panning = true;
    mapEl.classList.add('is-panning');
  }
  svg.setPointerCapture(e.pointerId);
});

svg.addEventListener('pointermove', function(e) {
  var prev = pointers[e.pointerId];
  if (!prev) return;
  var cur = {x:e.clientX, y:e.clientY};
  pointers[e.pointerId] = cur;
  moved = true;

  var keys = Object.keys(pointers);
  if (keys.length >= 2) {
    var a = pointers[keys[0]], b = pointers[keys[1]];
    var dist = Math.hypot(a.x-b.x, a.y-b.y);
    if (pinchDist > 0) {
      var mid = toSvgCoords((a.x+b.x)/2, (a.y+b.y)/2);
      zoomAt(mid.x, mid.y, dist/pinchDist);
    }
    pinchDist = dist;
    return;
  }

  var rect = svg.getBoundingClientRect();
  var dx = ((cur.x-prev.x)/rect.width)*W;
  var dy = ((cur.y-prev.y)/rect.height)*H;
  var v = clampView(view.scale, view.x+dx, view.y+dy);
  view.x = v.x; view.y = v.y;
  applyView(false);

  if (!panning) {
    updateHover(e);
  }
});

function endPointer(e) {
  delete pointers[e.pointerId];
  if (Object.keys(pointers).length < 2) pinchDist = 0;
  if (Object.keys(pointers).length === 0) {
    panning = false;
    mapEl.classList.remove('is-panning');
  }
}
svg.addEventListener('pointerup', endPointer);
svg.addEventListener('pointercancel', endPointer);

svg.addEventListener('wheel', function(e) {
  e.preventDefault();
  var pt = toSvgCoords(e.clientX, e.clientY);
  var factor = e.deltaY < 0 ? 1.2 : 1/1.2;
  zoomAt(pt.x, pt.y, factor);
}, {passive:false});

mapEl.addEventListener('mouseleave', function() {
  setHover(null);
});

function updateHover(e) {
  if (panning) return;
  var target = e.target;
  if (!target) return;
  var num = target.dataset && target.dataset.num;
  if (!num) { setHover(null); return; }
  num = parseInt(num, 10);
  var rect = mapEl.getBoundingClientRect();
  var x = e.clientX - rect.left;
  var y = e.clientY - rect.top;
  setHover({num:num, x:x, y:y, right: x > rect.width/2});
}

function setHover(h) {
  hover = h;
  var tooltip = document.querySelector('.map-tooltip');
  var prevHovered = document.querySelector('.map-country.is-hovered, .map-marker.is-hovered');
  if (prevHovered) prevHovered.classList.remove('is-hovered');

  if (!h) {
    if (tooltip) tooltip.style.display = 'none';
    return;
  }

  var el = document.querySelector('[data-num="'+h.num+'"]');
  if (el) el.classList.add('is-hovered');

  if (!tooltip) return;
  var country = geo.countries && geo.countries.find(function(c){return c.id===h.num;});
  var englishName = country ? country.name : '';
  var status = statusByNum[h.num];

  var primary = englishName || 'somewhere';
  var statusLabel = status ? (STATUS_LABELS[status] || status) : 'not yet visited';
  var statusCls = status ? STATUS_CLASS[status] : 'c-none';

  tooltip.innerHTML = '<div class="map-tooltip-name">'+escHtml(primary)+'</div>' +
    '<div class="map-tooltip-status '+statusCls+'">'+escHtml(statusLabel)+'</div>';
  tooltip.style.display = 'block';
  tooltip.style.left = h.x + 'px';
  tooltip.style.top = h.y + 'px';
  tooltip.style.transform = 'translate('+(h.right ? 'calc(-100% - 14px)' : '14px')+', -50%)';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

svg.addEventListener('mousemove', updateHover);
svg.addEventListener('mouseenter', updateHover, true);

document.querySelectorAll('.map-zoom-in').forEach(function(b) {
  b.addEventListener('click', function() { zoomAt(W/2,H/2,1.6); });
});
document.querySelectorAll('.map-zoom-out').forEach(function(b) {
  b.addEventListener('click', function() { zoomAt(W/2,H/2,1/1.6); });
});
document.querySelectorAll('.map-reset-btn').forEach(function(b) {
  b.addEventListener('click', function() {
    view = {scale:1,x:0,y:0};
    applyView(true);
  });
});

window.addEventListener('travel:focus', function(e) {
  focusOnRegion(e.detail);
});

document.querySelectorAll('.country-zoom').forEach(function(btn) {
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    var num = parseInt(btn.dataset.num, 10);
    focusOnRegion(num);
  });
});

document.querySelectorAll('.country-summary').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var country = btn.closest('.country');
    if (!country) return;
    var isOpen = country.classList.contains('is-open');
    country.classList.toggle('is-open', !isOpen);
    btn.setAttribute('aria-expanded', String(!isOpen));
  });
});

applyView(false);

if (nextTrip) {
  initNextTripCountdown(nextTrip);
}

function initNextTripCountdown(trip) {
  var el = document.querySelector('.next-trip-countdowns');
  if (!el) return;
  var departMs = Date.parse(trip.depart);
  var returnMs = trip.return ? Date.parse(trip.return) : null;
  if (isNaN(departMs)) return;

  function pad(n) { return String(n).padStart(2,'0'); }
  function breakdown(ms) {
    var total = Math.max(0, Math.floor(ms/1000));
    return {
      days: Math.floor(total/86400),
      hours: Math.floor((total%86400)/3600),
      mins: Math.floor((total%3600)/60),
      secs: total%60
    };
  }
  function renderDuration(ms) {
    var p = breakdown(ms);
    var out = '';
    if (p.days > 0) out += '<span class="next-trip-unit">'+p.days+'d</span>';
    out += '<span class="next-trip-unit">'+pad(p.hours)+'h</span>';
    out += '<span class="next-trip-unit">'+pad(p.mins)+'m</span>';
    out += '<span class="next-trip-unit">'+pad(p.secs)+'s</span>';
    return '<span class="next-trip-time" aria-live="polite">'+out+'</span>';
  }

  function tick() {
    var now = Date.now();
    var beforeDepart = now < departMs;
    var beforeReturn = returnMs !== null && now < returnMs;
    var afterReturn = returnMs !== null && now >= returnMs;
    var afterDepartNoReturn = returnMs === null && now >= departMs;
    var tripCard = document.querySelector('.next-trip');

    if ((afterReturn || afterDepartNoReturn) && tripCard) {
      tripCard.style.display = 'none';
      return;
    }

    var html = '';
    if (beforeDepart) {
      html += '<div class="next-trip-row"><span class="next-trip-verb">leaves in</span>'+renderDuration(departMs-now)+'</div>';
      if (returnMs !== null) {
        html += '<div class="next-trip-row"><span class="next-trip-verb">back in</span>'+renderDuration(returnMs-now)+'</div>';
      }
    } else if (!beforeDepart && beforeReturn && returnMs !== null) {
      html += '<div class="next-trip-row"><span class="next-trip-verb">back in</span>'+renderDuration(returnMs-now)+'</div>';
    }
    el.innerHTML = html;
  }

  tick();
  setInterval(tick, 1000);
}

})();
