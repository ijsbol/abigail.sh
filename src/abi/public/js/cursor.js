(function () {
    'use strict';

    var WS_URL = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/cursors';
    var STORAGE_KEY = 'cursors-enabled';
    var COOKIE_NAME = 'cursors-popup-seen';
    var COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
    var MOVE_INTERVAL_MS = 33;
    var AUTO_DISMISS_MS = 60000;
    var RECONNECT_BASE = 1000;
    var RECONNECT_MAX = 30000;

    var currentPage = location.pathname;

    var enabled = localStorage.getItem(STORAGE_KEY) !== 'false';
    var supported = window.innerWidth > 700;
    var isActive = false;
    var ws = null;
    var reconnectTimer = null;
    var reconnectDelay = RECONNECT_BASE;
    var remoteClients = new Map();
    var globalCount = 0;
    var pageCounts = {};

    function clamp(v) { return Math.max(0, Math.min(1, v)); }

    function docSize() {
        var r = document.documentElement, b = document.body;
        return {
            w: Math.max(r.scrollWidth, r.clientWidth, b ? b.scrollWidth : 0),
            h: Math.max(r.scrollHeight, r.clientHeight, b ? b.scrollHeight : 0),
        };
    }

    function attrSel(name, val) {
        return '[' + name + '="' + CSS.escape(val) + '"]';
    }

    function anchorElFor(el) {
        return el.closest('[data-cursor-anchor], a[href], img[src], input[name], select[name], textarea[name]') || el;
    }

    function selectorFor(el) {
        if (el.id) return '#' + CSS.escape(el.id);

        var ca = el.getAttribute('data-cursor-anchor');
        if (ca !== null) return attrSel('data-cursor-anchor', ca);
        if (el instanceof HTMLAnchorElement) {
            var href = el.getAttribute('href');
            if (href !== null) return 'a' + attrSel('href', href);
        }
        if (el instanceof HTMLImageElement) {
            var src = el.getAttribute('src');
            if (src !== null) return 'img' + attrSel('src', src);
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
            var name = el.getAttribute('name');
            if (name !== null) return el.localName + attrSel('name', name);
        }

        var segs = [], cur = el;
        while (cur) {
            if (cur.id) { segs.unshift('#' + CSS.escape(cur.id)); break; }
            var tag = CSS.escape(cur.localName);
            var parent = cur.parentElement;
            if (!parent) { segs.unshift(tag); break; }
            var siblings = Array.from(parent.children).filter(function (s) { return s.localName === cur.localName; });
            segs.unshift(tag + ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')');
            cur = parent;
        }
        return segs.join(' > ');
    }

    function capturePos(cx, cy) {
        var vw = Math.max(window.innerWidth, 1), vh = Math.max(window.innerHeight, 1);
        var d = docSize();
        var el = document.elementFromPoint(cx, cy);
        var anchor = null;
        if (el) {
            var ae = anchorElFor(el);
            var rect = ae.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                anchor = {
                    selector: selectorFor(ae),
                    x: clamp((cx - rect.left) / rect.width),
                    y: clamp((cy - rect.top) / rect.height),
                };
            }
        }
        return {
            x: clamp(cx / vw),
            y: clamp(cy / vh),
            docX: clamp((cx + window.scrollX) / Math.max(d.w, 1)),
            docY: clamp((cy + window.scrollY) / Math.max(d.h, 1)),
            anchor: anchor,
        };
    }

    function resolvePos(pos) {
        if (pos.anchor) {
            try {
                var cands = Array.from(document.querySelectorAll(pos.anchor.selector))
                    .map(function (e) { return { el: e, rect: e.getBoundingClientRect() }; })
                    .filter(function (c) { return c.rect.width > 0 && c.rect.height > 0; });
                if (cands.length > 0) {
                    var d = docSize();
                    var best = cands[0];
                    if (typeof pos.docX === 'number' && typeof pos.docY === 'number') {
                        for (var i = 1; i < cands.length; i++) {
                            var cc = cands[i], bc = best;
                            var cx2 = (cc.rect.left + window.scrollX + pos.anchor.x * cc.rect.width) / Math.max(d.w, 1);
                            var cy2 = (cc.rect.top + window.scrollY + pos.anchor.y * cc.rect.height) / Math.max(d.h, 1);
                            var bx = (bc.rect.left + window.scrollX + pos.anchor.x * bc.rect.width) / Math.max(d.w, 1);
                            var by = (bc.rect.top + window.scrollY + pos.anchor.y * bc.rect.height) / Math.max(d.h, 1);
                            if (Math.hypot(cx2 - pos.docX, cy2 - pos.docY) < Math.hypot(bx - pos.docX, by - pos.docY)) {
                                best = cc;
                            }
                        }
                    }
                    return {
                        left: best.rect.left + clamp(pos.anchor.x) * best.rect.width,
                        top: best.rect.top + clamp(pos.anchor.y) * best.rect.height,
                    };
                }
            } catch (e) {}
        }
        if (typeof pos.docX === 'number' && typeof pos.docY === 'number') {
            var d2 = docSize();
            return { left: clamp(pos.docX) * d2.w - window.scrollX, top: clamp(pos.docY) * d2.h - window.scrollY };
        }
        return { left: clamp(pos.x) * window.innerWidth, top: clamp(pos.y) * window.innerHeight };
    }

    var overlay = document.createElement('div');
    overlay.className = 'cursor-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);

    var cursorEls = new Map();

    function makeCursorEl(color) {
        var div = document.createElement('div');
        div.className = 'remote-cursor';
        div.innerHTML = '<svg width="18" height="20" viewBox="0 0 18 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 1L15 9.5L9.5 11L7.5 18L3 1Z" fill="' + color + '" stroke="white" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>';
        return div;
    }

    var overlayFrame = null;

    function flushOverlay() {
        overlayFrame = null;
        if (!enabled) return;
        var visible = new Set();
        remoteClients.forEach(function (c, id) {
            if (c.page !== currentPage) return;
            visible.add(id);
            var el = cursorEls.get(id);
            if (!el) {
                el = makeCursorEl(c.color);
                overlay.appendChild(el);
                cursorEls.set(id, el);
            }
            var p = resolvePos(c);
            el.style.left = p.left + 'px';
            el.style.top = p.top + 'px';
        });
        cursorEls.forEach(function (el, id) {
            if (!visible.has(id)) { el.remove(); cursorEls.delete(id); }
        });
    }

    function scheduleOverlay() {
        if (overlayFrame !== null) return;
        overlayFrame = requestAnimationFrame(flushOverlay);
    }

    window.addEventListener('resize', scheduleOverlay, { passive: true });
    window.addEventListener('scroll', scheduleOverlay, { passive: true, capture: true });

    function clearOverlay() {
        overlay.innerHTML = '';
        cursorEls.clear();
    }

    var EYE_OPEN = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>';
    var EYE_CLOSED = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    var toggleBtn = document.querySelector('.presence-toggle');

    function syncToggleBtn() {
        if (!toggleBtn) return;
        toggleBtn.setAttribute('aria-label', enabled ? 'disable cursor sharing' : 'enable cursor sharing');
        toggleBtn.innerHTML = enabled ? EYE_OPEN : EYE_CLOSED;
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', function () {
            enabled = !enabled;
            try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch (e) {}
            syncToggleBtn();
            if (enabled && supported) startConnection();
            else stopConnection();
        });
    }

    function readCookie(name) {
        var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : null;
    }

    function writeCookie(name, value, maxAge) {
        document.cookie = name + '=' + encodeURIComponent(value) + '; max-age=' + maxAge + '; path=/; SameSite=Lax';
    }

    var popup = null;
    var popupTimer = null;

    function showPopup() {
        if (readCookie(COOKIE_NAME) || popup) return;
        popup = document.createElement('button');
        popup.type = 'button';
        popup.className = 'presence-popup';
        popup.setAttribute('aria-label', 'dismiss cursor sharing notice');
        popup.textContent = "your cursor's position is shared with everyone currently on the website :3 ask your friends to try it out!";
        document.body.appendChild(popup);
        popup.addEventListener('click', dismissPopup);
        popupTimer = setTimeout(dismissPopup, AUTO_DISMISS_MS);
    }

    function dismissPopup() {
        if (!popup) return;
        writeCookie(COOKIE_NAME, '1', COOKIE_MAX_AGE);
        popup.remove();
        popup = null;
        if (popupTimer) { clearTimeout(popupTimer); popupTimer = null; }
    }

    var countEl = null;

    function getCountEl() {
        if (countEl) return countEl;
        var col = document.querySelector('.meta-column');
        if (!col) return null;
        countEl = document.createElement('div');
        countEl.className = 'presence-count';
        countEl.setAttribute('aria-live', 'polite');
        col.appendChild(countEl);
        return countEl;
    }

    function syncPresenceCount() {
        var el = getCountEl();
        if (!el) return;
        if (!enabled || globalCount === 0) { el.style.display = 'none'; return; }
        var here = pageCounts[currentPage] || 0;
        el.style.display = '';
        el.setAttribute('aria-label', here + ' on this page, ' + globalCount + ' online');
        el.textContent = here + ' here \xb7 ' + globalCount + ' online';
    }

    var NAV = [
        { href: '/', test: function (p) { return p === '/'; } },
        { href: '/profile', test: function (p) { return p === '/profile'; } },
        { href: '/resume', test: function (p) { return p === '/resume' || p.startsWith('/resume/'); } },
        { href: '/blog', test: function (p) { return p === '/blog' || p.startsWith('/blog/'); } },
        { href: '/projects', test: function (p) { return p === '/projects' || p.startsWith('/projects/'); } },
        { href: '/photography', test: function (p) { return p === '/photography'; } },
        { href: '/travel', test: function (p) { return p === '/travel'; } },
        { href: '/watch-list', test: function (p) { return p === '/watch-list'; } },
        { href: '/guestbook', test: function (p) { return p === '/guestbook'; } },
        { href: '/buttons', test: function (p) { return p === '/buttons'; } },
    ];

    var EYE_SMALL = '<svg class="nav-presence-eye" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.25-4 6.5-4 6.5 4 6.5 4-2.25 4-6.5 4S1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/></svg>';

    function syncNavPresence() {
        document.querySelectorAll('.pages a').forEach(function (link) {
            var href = link.getAttribute('href');
            var item = NAV.find(function (n) { return n.href === href; });
            if (!item) return;

            var count = 0;
            if (enabled) {
                Object.keys(pageCounts).forEach(function (p) {
                    if (item.test(p)) count += pageCounts[p];
                });
            }

            var indicator = link.querySelector('.nav-presence-indicator');
            if (count > 0) {
                var label = count + ' ' + (count === 1 ? 'visitor' : 'visitors') + ' currently viewing this section';
                if (!indicator) {
                    indicator = document.createElement('span');
                    indicator.className = 'nav-presence-indicator';
                    indicator.setAttribute('aria-hidden', 'true');
                    indicator.innerHTML = EYE_SMALL + '<span class="nav-presence-number"></span>';
                    link.appendChild(indicator);
                }
                indicator.querySelector('.nav-presence-number').textContent = String(count);
                indicator.setAttribute('data-tooltip', label);
                indicator.setAttribute('aria-label', label);
            } else if (indicator) {
                indicator.remove();
            }
        });
    }

    function startConnection() {
        isActive = true;
        reconnectDelay = RECONNECT_BASE;
        attemptConnect();
    }

    function stopConnection() {
        isActive = false;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (ws) { ws.close(); ws = null; }
        remoteClients.clear();
        globalCount = 0;
        pageCounts = {};
        clearOverlay();
        syncPresenceCount();
        syncNavPresence();
    }

    function attemptConnect() {
        if (!isActive) return;
        try { ws = new WebSocket(WS_URL); } catch (e) { return; }

        ws.onopen = function () {
            reconnectDelay = RECONNECT_BASE;
            ws.send(JSON.stringify({ type: 'page', page: currentPage }));
            showPopup();
        };

        ws.onmessage = function (e) {
            var msg;
            try { msg = JSON.parse(e.data); } catch (err) { return; }

            if (msg.type === 'init') {
                remoteClients.clear();
                msg.clients.forEach(function (c) { remoteClients.set(c.id, c); });
                scheduleOverlay();
            } else if (msg.type === 'join') {
                remoteClients.set(msg.id, { id: msg.id, color: msg.color, page: msg.page, x: 0, y: 0, anchor: null });
                scheduleOverlay();
            } else if (msg.type === 'move') {
                var c = remoteClients.get(msg.id);
                if (c) {
                    c.x = msg.x; c.y = msg.y;
                    c.docX = msg.docX; c.docY = msg.docY;
                    c.anchor = msg.anchor || null;
                    c.page = msg.page;
                    scheduleOverlay();
                }
            } else if (msg.type === 'page') {
                var c2 = remoteClients.get(msg.id);
                if (c2) { c2.page = msg.page; scheduleOverlay(); }
            } else if (msg.type === 'leave') {
                remoteClients.delete(msg.id);
                var el = cursorEls.get(msg.id);
                if (el) { el.remove(); cursorEls.delete(msg.id); }
            } else if (msg.type === 'counts') {
                globalCount = msg.global;
                pageCounts = msg.pages;
                syncPresenceCount();
                syncNavPresence();
            }
        };

        ws.onclose = function () {
            ws = null;
            if (isActive) {
                reconnectTimer = setTimeout(function () {
                    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
                    attemptConnect();
                }, reconnectDelay);
            }
        };

        ws.onerror = function () { if (ws) ws.close(); };
    }

    var lastSentAt = 0;
    var sendTimer = null;
    var pendingPt = null;
    var lastPtr = null;

    function flushMove() {
        sendTimer = null;
        if (!pendingPt || !ws || ws.readyState !== WebSocket.OPEN) return;
        var pt = pendingPt;
        pendingPt = null;
        lastSentAt = performance.now();
        ws.send(JSON.stringify(Object.assign({ type: 'move', page: currentPage }, capturePos(pt.x, pt.y))));
    }

    function queueMove(pt) {
        pendingPt = pt;
        var wait = MOVE_INTERVAL_MS - (performance.now() - lastSentAt);
        if (wait <= 0) {
            if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
            flushMove();
        } else if (!sendTimer) {
            sendTimer = setTimeout(flushMove, wait);
        }
    }

    window.addEventListener('mousemove', function (e) {
        if (!isActive || !ws) return;
        lastPtr = { x: e.clientX, y: e.clientY };
        queueMove(lastPtr);
    }, { passive: true });

    window.addEventListener('scroll', function () {
        if (!isActive || !ws || !lastPtr) return;
        queueMove(lastPtr);
    }, { passive: true, capture: true });

    var mql = window.matchMedia('(max-width: 700px)');

    function syncSupported() {
        supported = !mql.matches;
        if (!supported && isActive) stopConnection();
        else if (supported && enabled && !isActive) startConnection();
    }

    mql.addEventListener('change', syncSupported);

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('theme', theme); } catch (e) {}
    }

    var themeBtn = document.querySelector('.theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', function () {
            applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
        });
    }

    syncToggleBtn();
    syncPresenceCount();

    if (enabled && supported) startConnection();

})();
