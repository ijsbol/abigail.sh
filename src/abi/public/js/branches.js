(function () {
    'use strict';

    var DURATION_MS = 10_000;
    var MAX_BRANCHES = 67;
    var MAX_DEPTH = 5;
    var TAU = Math.PI * 2;
    var DOWN = Math.PI / 2;

    var BRANCH_COLOR = 'rgb(158, 112, 138)';
    var PETAL_COLOR = 'rgb(219, 148, 174)';
    var FLOWER_CORE_COLOR = 'rgb(242, 208, 222)';

    var canvas = document.querySelector('.branch-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var rafId = 0;
    var resizeTimer = 0;
    var animating = false;
    var lastSize = '';

    function measure() {
        var meta = canvas.parentElement;
        var nav = meta.querySelector('.pages');
        var top = nav.offsetTop + nav.offsetHeight;
        canvas.style.top = top + 'px';
        canvas.style.height = Math.max(0, meta.clientHeight - top) + 'px';
        return { w: canvas.clientWidth, h: canvas.clientHeight };
    }

    function drawFlower(x, y, depth) {
        var r = 2.2 + Math.random() * 1.6;
        if (depth >= 1 && Math.random() < 0.4) {
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = PETAL_COLOR;
            for (var p = 0; p < 5; p++) {
                var pa = (p / 5) * TAU + Math.random() * 0.25;
                ctx.beginPath();
                ctx.ellipse(x + Math.cos(pa) * r, y + Math.sin(pa) * r, r * 0.85, r * 0.5, pa, 0, TAU);
                ctx.fill();
            }
            ctx.globalAlpha = 0.65;
            ctx.fillStyle = FLOWER_CORE_COLOR;
            ctx.beginPath();
            ctx.arc(x, y, r * 0.45, 0, TAU);
            ctx.fill();
        } else {
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = PETAL_COLOR;
            ctx.beginPath();
            ctx.arc(x, y, 1.4, 0, TAU);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function grow(instant) {
        cancelAnimationFrame(rafId);
        animating = false;
        if (getComputedStyle(canvas).display === 'none') return;
        var size = measure();
        var w = size.w;
        var h = size.h;
        lastSize = canvas.style.top + '/' + w + 'x' + h;
        if (w < 40 || h < 120) return;

        var dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = 'round';

        var speed = h / 7500; // px per ms; trunks finish ~5s, twigs trail to ~10s
        var count = 0;
        var branches = [];
        var trunks = 2 + Math.floor(Math.random() * 3);
        for (var t = 0; t < trunks; t++) {
            count++;
            branches.push({
                x: w * ((t + 0.2 + Math.random() * 0.6) / trunks),
                y: 0,
                angle: DOWN + (Math.random() - 0.5) * 0.2,
                left: h * (0.62 + Math.random() * 0.13),
                width: 2.2,
                depth: 0,
            });
        }

        function tick(dt) {
            for (var i = branches.length - 1; i >= 0; i--) {
                var b = branches[i];
                var step = Math.min(speed * dt * (1 + b.depth * 0.2), b.left);

                b.angle += (Math.random() - 0.5) * 0.28;
                b.angle += (DOWN - b.angle) * 0.04;
                if (b.x < w * 0.15) b.angle += (DOWN - 0.45 - b.angle) * 0.2;
                if (b.x > w * 0.85) b.angle += (DOWN + 0.45 - b.angle) * 0.2;
                b.angle = Math.max(DOWN - 0.95, Math.min(DOWN + 0.95, b.angle));

                var nx = Math.max(2, Math.min(w - 2, b.x + Math.cos(b.angle) * step));
                var ny = b.y + Math.sin(b.angle) * step;

                ctx.globalAlpha = Math.max(0.22, 0.5 - b.depth * 0.06);
                ctx.strokeStyle = BRANCH_COLOR;
                ctx.lineWidth = Math.max(0.5, b.width);
                ctx.beginPath();
                ctx.moveTo(b.x, b.y);
                ctx.lineTo(nx, ny);
                ctx.stroke();

                b.x = nx;
                b.y = ny;
                b.left -= step;
                b.width *= 0.995;

                var canBranch = b.depth < MAX_DEPTH
                    && count < MAX_BRANCHES
                    && b.y > 30
                    && b.left > 12;
                if (canBranch && Math.random() < step * (0.022 - b.depth * 0.003)) {
                    count++;
                    branches.push({
                        x: b.x,
                        y: b.y,
                        angle: b.angle + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.5),
                        left: Math.max(14, b.left * (0.4 + Math.random() * 0.3)),
                        width: b.width * 0.62,
                        depth: b.depth + 1,
                    });
                }

                if (b.left <= 0.5 || b.y > h - 4) {
                    branches.splice(i, 1);
                    drawFlower(b.x, b.y, b.depth);
                }
            }
        }

        if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) {
            for (var guard = 0; guard < 2000 && branches.length; guard++) tick(16);
            while (branches.length) {
                var b = branches.pop();
                drawFlower(b.x, b.y, b.depth);
            }
            return;
        }

        animating = true;
        var started = performance.now();
        var prev = started;
        function frame(now) {
            tick(Math.min(now - prev, 50));
            prev = now;
            if (branches.length && now - started < DURATION_MS) {
                rafId = requestAnimationFrame(frame);
            } else {
                animating = false;
                while (branches.length) {
                    var b = branches.pop();
                    drawFlower(b.x, b.y, b.depth);
                }
            }
        }
        rafId = requestAnimationFrame(frame);
    }

    // re-fit when the column moves or resizes (window resize, async content)
    function refit() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            var wasAnimating = animating;
            var before = lastSize;
            var size = measure();
            if (canvas.style.top + '/' + size.w + 'x' + size.h === before) return;
            grow(!wasAnimating);
        }, 250);
    }

    window.addEventListener('resize', refit);
    grow(false);
    var meta = canvas.parentElement;
    if (window.ResizeObserver && meta) new ResizeObserver(refit).observe(meta);
})();
