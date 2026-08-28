(function () {
    'use strict';

    const PROXIED_HOSTS = new Set([
        'cdn.discordapp.com', 'media.discordapp.net', 'dcdn.dstn.to',
        's4.anilist.co', 'i.scdn.co', 'lastfm.freetls.fastly.net',
        'cdn.bsky.app', 'video.bsky.app',
    ]);

    const STATUS_LABEL = { online: 'online', idle: 'idle', dnd: 'do not disturb', offline: 'offline' };
    const STATUS_COLOR = { online: '#3ba55d', idle: '#faa61a', dnd: '#ed4245', offline: '#747f8d' };
    const ACTIVITY_CUSTOM = 4;
    const LANYARD_POLL_MS = 30_000;
    const LASTFM_POLL_MS = 30_000;
    const CLOCK_TICK_MS = 1_000;
    const WATCH_STEP = 6;
    const TRACKS_STEP = 6;

    function esc(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function encodeMediaHash(url) {
        const bytes = new TextEncoder().encode(url);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function proxied(url) {
        if (!url) return null;
        try {
            const u = new URL(url);
            if (u.protocol !== 'https:' || !PROXIED_HOSTS.has(u.hostname)) return url;
        } catch { return url; }
        return '/api/media-proxy/' + encodeMediaHash(url);
    }

    function relativeTime(unix, now) {
        const diff = Math.max(0, Math.floor(now / 1000 - unix));
        if (diff < 60) return diff + 's ago';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        const days = Math.floor(diff / 86400);
        if (days < 30) return days + 'd ago';
        if (days < 365) return Math.floor(days / 30) + 'mo ago';
        return Math.floor(days / 365) + 'y ago';
    }

    function formatClock(seconds) {
        const s = Math.max(0, Math.floor(seconds));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function intToHex(color) {
        return '#' + color.toString(16).padStart(6, '0');
    }

    function lanyardGradient(profile) {
        const colors = (profile.user.display_name_styles || {}).colors || [];
        if (colors.length >= 2) return { start: intToHex(colors[0]), end: intToHex(colors[1]) };
        if (colors.length === 1) return { start: intToHex(colors[0]), end: intToHex(colors[0]) };
        if (profile.user.accent_color != null) {
            const hex = intToHex(profile.user.accent_color);
            return { start: hex, end: hex };
        }
        return { start: '#e84b5f', end: '#ff8296' };
    }

    function avatarUrl(user, size) {
        size = size || 256;
        if (!user.avatar) return null;
        const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
        return 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.' + ext + '?size=' + size;
    }

    function avatarDecorationUrl(user) {
        const asset = (user.avatar_decoration_data || {}).asset;
        if (!asset) return null;
        return 'https://cdn.discordapp.com/avatar-decoration-presets/' + asset + '.png?size=256&passthrough=true';
    }

    function bannerUrl(user, size) {
        size = size || 600;
        if (!user.banner) return null;
        const ext = user.banner.startsWith('a_') ? 'gif' : 'png';
        return 'https://cdn.discordapp.com/banners/' + user.id + '/' + user.banner + '.' + ext + '?size=' + size;
    }

    function dcdnBannerUrl(userId) {
        return 'https://dcdn.dstn.to/banners/' + userId + '?size=1024';
    }

    function guildBadgeUrl(user) {
        const guild = user.primary_guild;
        if (!guild) return null;
        return 'https://cdn.discordapp.com/clan-badges/' + guild.identity_guild_id + '/' + guild.badge + '.png';
    }

    function activityAssetUrl(activity, key) {
        const raw = (activity.assets || {})[key];
        if (!raw) return null;
        if (raw.startsWith('spotify:')) return 'https://i.scdn.co/image/' + raw.slice('spotify:'.length);
        if (raw.startsWith('mp:external/')) return 'https://media.discordapp.net/external/' + raw.slice('mp:external/'.length);
        if (activity.application_id) return 'https://cdn.discordapp.com/app-assets/' + activity.application_id + '/' + raw + '.png';
        return null;
    }

    var initial = window.__PROFILE__ || {};
    var state = {
        lanyard: initial.lanyard || null,
        tracks: initial.tracks || null,
        now: Date.now(),
        tracksVisible: initial.recentTracksInitialVisible || 6,
        recentTracksMax: initial.recentTracksMax || 50,
        lastLanyardAt: -Infinity,
        lastTracksAt: -Infinity,
    };

    function renderStatusDot(status) {
        var color = STATUS_COLOR[status] || '#747f8d';
        var label = STATUS_LABEL[status] || status;
        return '<span class="status-dot" style="background-color:' + esc(color) + '" aria-label="' + esc(label) + '"></span>';
    }

    function renderActivityCard(activity) {
        if (activity.type === ACTIVITY_CUSTOM) return '';
        var large = proxied(activityAssetUrl(activity, 'large_image'));
        var small = proxied(activityAssetUrl(activity, 'small_image'));
        var verbMap = { 1: 'streaming', 2: 'listening to', 3: 'watching', 5: 'competing in' };
        var verb = verbMap[activity.type] || 'playing';
        var smallImg = small ? '<img src="' + esc(small) + '" alt="' + esc((activity.assets || {}).small_text || '') + '" class="activity-art-small" loading="lazy">' : '';
        var largeContent = large
            ? '<img src="' + esc(large) + '" alt="' + esc((activity.assets || {}).large_text || activity.name) + '" loading="lazy">'
            : '<div class="activity-art placeholder" aria-hidden="true"></div>';
        var details = activity.details ? '<div class="activity-detail">' + esc(activity.details) + '</div>' : '';
        var st = activity.state ? '<div class="activity-detail">' + esc(activity.state) + '</div>' : '';
        return '<div class="activity-card"><div class="activity-art">' + largeContent + smallImg + '</div><div class="activity-text"><div class="activity-verb">' + esc(verb) + '</div><div class="activity-name">' + esc(activity.name) + '</div>' + details + st + '</div></div>';
    }

    function renderLanyardCard(profile) {
        if (!profile) {
            return '<p class="muted">couldn&#39;t load discord presence right now.</p>';
        }
        var user = profile.user;
        var gradient = lanyardGradient(profile);

        var styleEl = document.getElementById('profileGradientStyle');
        if (styleEl) {
            styleEl.textContent = '.profile-page .lanyard-card{--lanyard-start:' + gradient.start + ';--lanyard-end:' + gradient.end + '}';
        }

        var avatar = proxied(avatarUrl(user, 256));
        var decoration = proxied(avatarDecorationUrl(user));
        var directBanner = bannerUrl(user, 600);
        var bannerSrc = proxied(directBanner) || proxied(dcdnBannerUrl(user.id));
        var badge = proxied(guildBadgeUrl(user));
        var displayName = user.display_name || user.global_name || user.username;

        var guildTag = user.primary_guild
            ? '<span class="lanyard-tag">' + (badge ? '<img src="' + esc(badge) + '" alt="" aria-hidden="true">' : '') + esc(user.primary_guild.tag) + '</span>'
            : '';

        var customStatusHtml = (profile.customStatus && profile.customStatus.state)
            ? '<span class="dot-sep">·</span><span>' + esc(profile.customStatus.state) + '</span>'
            : '';

        var otherActivities = profile.activities.filter(function (a) { return a.type !== ACTIVITY_CUSTOM && a.name !== 'Spotify'; });
        var spotifyLive = profile.listeningToSpotify && profile.spotify ? profile.spotify : null;
        var showActivities = otherActivities.length > 0;
        var activitiesHtml = showActivities
            ? '<div class="lanyard-activities">' + otherActivities.map(renderActivityCard).join('') + '</div>'
            : '';

        var bannerHtml = bannerSrc
            ? '<img src="' + esc(bannerSrc) + '" alt="" aria-hidden="true" class="lanyard-banner-media" onerror="this.style.display=\'none\'">'
            : '';

        return '<div class="lanyard-card">' +
            '<div class="lanyard-banner">' + bannerHtml + '</div>' +
            '<div class="lanyard-body">' +
                '<div class="lanyard-avatar-wrap">' +
                    (avatar ? '<img src="' + esc(avatar) + '" alt="' + esc(user.username) + '" class="lanyard-avatar">' : '') +
                    (decoration ? '<img src="' + esc(decoration) + '" alt="" aria-hidden="true" class="lanyard-decoration">' : '') +
                    '<span class="lanyard-status-dot">' + renderStatusDot(profile.status) + '</span>' +
                '</div>' +
                '<div class="lanyard-info">' +
                    '<h2 class="lanyard-name">' + esc(displayName) + '</h2>' +
                    '<div class="lanyard-handle"><span>@' + esc(user.username) + '</span>' + guildTag + '</div>' +
                    '<div class="lanyard-status-line">' + renderStatusDot(profile.status) + '<span>' + esc(STATUS_LABEL[profile.status] || profile.status) + '</span>' + customStatusHtml + '</div>' +
                '</div>' +
            '</div>' +
            activitiesHtml +
            '</div>';
    }

    function renderLoopTag(count) {
        if (count <= 1) return '';
        return '<span class="loop-tag" title="played ' + count + ' times in a row">looped ' + count + ' times</span>';
    }

    function spotifyProgress(spotify, now) {
        var start = spotify.timestamps.start;
        var end = spotify.timestamps.end;
        if (now <= start) return 0;
        if (now >= end) return 100;
        return (now - start) / (end - start) * 100;
    }

    function renderSpotifyCard(spotify, now, loopCount) {
        var progress = spotifyProgress(spotify, now);
        var elapsed = Math.min(
            (spotify.timestamps.end - spotify.timestamps.start) / 1000,
            Math.max(0, (now - spotify.timestamps.start) / 1000)
        );
        var duration = (spotify.timestamps.end - spotify.timestamps.start) / 1000;
        var artSrc = proxied(spotify.album_art_url);
        var artHtml = artSrc
            ? '<img src="' + esc(artSrc) + '" alt="' + esc(spotify.album) + '" loading="lazy">'
            : '<div class="activity-art placeholder" aria-hidden="true"></div>';
        return '<a href="https://open.spotify.com/track/' + esc(spotify.track_id) + '" target="_blank" rel="noreferrer" class="lanyard-card now-playing now-playing-spotify">' +
            '<div class="activity-art large">' + artHtml + '</div>' +
            '<div class="activity-text">' +
                '<div class="activity-verb">now playing · spotify</div>' +
                '<div class="activity-name-row"><div class="activity-name">' + esc(spotify.song) + '</div>' + renderLoopTag(loopCount) + '</div>' +
                '<div class="activity-detail">by ' + esc(spotify.artist) + '</div>' +
                (spotify.album ? '<div class="activity-detail dim">on ' + esc(spotify.album) + '</div>' : '') +
                '<div class="spotify-progress-row">' +
                    '<span class="spotify-time" id="spotifyElapsed">' + formatClock(elapsed) + '</span>' +
                    '<div class="spotify-progress" role="progressbar" aria-valuenow="' + Math.round(progress) + '" aria-valuemin="0" aria-valuemax="100" id="spotifyProgressBar">' +
                        '<div class="spotify-progress-bar" style="width:' + progress + '%" id="spotifyProgressFill"></div>' +
                    '</div>' +
                    '<span class="spotify-time">' + formatClock(duration) + '</span>' +
                '</div>' +
            '</div>' +
            '</a>';
    }

    function renderLastFmCard(track, loopCount) {
        var artSrc = proxied(track.image);
        var artHtml = artSrc
            ? '<img src="' + esc(artSrc) + '" alt="' + esc(track.album) + '" loading="lazy">'
            : '<div class="activity-art placeholder" aria-hidden="true"></div>';
        return '<div class="lanyard-card now-playing">' +
            '<div class="activity-art large">' + artHtml + '</div>' +
            '<div class="activity-text">' +
                '<div class="activity-verb">now playing · last.fm</div>' +
                '<div class="activity-name-row"><a href="' + esc(track.url) + '" target="_blank" rel="noreferrer" class="activity-name">' + esc(track.name) + '</a>' + renderLoopTag(loopCount) + '</div>' +
                '<div class="activity-detail">by ' + esc(track.artist) + '</div>' +
                (track.album ? '<div class="activity-detail dim">on ' + esc(track.album) + '</div>' : '') +
            '</div>' +
            '</div>';
    }

    function groupConsecutiveTracks(tracks) {
        var groups = [];
        for (var i = 0; i < tracks.length; i++) {
            var track = tracks[i];
            var last = groups[groups.length - 1];
            if (last && last.track.artist === track.artist && last.track.name === track.name) {
                last.count += 1;
            } else {
                groups.push({ track: track, count: 1 });
            }
        }
        return groups;
    }

    function countCurrentLoop(name, artist, pastTracks) {
        var count = 1;
        for (var i = 0; i < pastTracks.length; i++) {
            var t = pastTracks[i];
            if (t.name === name && t.artist === artist) count++;
            else break;
        }
        return count;
    }

    function computeNowPlaying() {
        var lanyard = state.lanyard;
        var tracks = state.tracks;
        var spotifyLive = lanyard && lanyard.listeningToSpotify && lanyard.spotify ? lanyard.spotify : null;
        var lastFmNowPlaying = tracks ? (tracks.find(function (t) { return t.nowPlaying; }) || null) : null;
        var pastTracks = tracks ? tracks.filter(function (t) { return !t.nowPlaying; }) : [];
        var currentSong = spotifyLive ? spotifyLive.song : (lastFmNowPlaying ? lastFmNowPlaying.name : null);
        var currentArtist = spotifyLive ? spotifyLive.artist : (lastFmNowPlaying ? lastFmNowPlaying.artist : null);
        var loopCount = (currentSong && currentArtist) ? countCurrentLoop(currentSong, currentArtist, pastTracks) : 1;
        return { spotifyLive: spotifyLive, lastFmNowPlaying: lastFmNowPlaying, loopCount: loopCount, pastTracks: pastTracks };
    }

    function renderNowPlaying() {
        var r = computeNowPlaying();
        if (r.spotifyLive) return renderSpotifyCard(r.spotifyLive, state.now, r.loopCount);
        if (r.lastFmNowPlaying) return renderLastFmCard(r.lastFmNowPlaying, r.loopCount);
        return '<p class="muted">nothing playing right now.</p>';
    }

    function renderTrackRow(group) {
        var track = group.track;
        var artSrc = proxied(track.image);
        var artHtml = artSrc
            ? '<img src="' + esc(artSrc) + '" alt="' + esc(track.album) + '" loading="lazy">'
            : '<div class="track-cover-placeholder" aria-hidden="true"></div>';
        var pulseHtml = track.nowPlaying ? '<span class="track-pulse" aria-hidden="true"></span>' : '';
        var loopHtml = group.count > 1 ? '<span class="loop-tag" title="played ' + group.count + ' times in a row">looped ' + group.count + ' times</span>' : '';
        var whenText = track.nowPlaying ? 'now playing' : (track.playedAt ? relativeTime(track.playedAt, state.now) : '');
        var dataUnix = track.playedAt ? ' data-unix="' + track.playedAt + '"' : '';
        return '<li class="track-row">' +
            '<div class="track-cover">' + artHtml + pulseHtml + '</div>' +
            '<div class="track-meta">' +
                '<div class="track-name-row"><a href="' + esc(track.url) + '" target="_blank" rel="noreferrer" class="track-name">' + esc(track.name) + '</a>' + loopHtml + '</div>' +
                '<div class="track-artist">' + esc(track.artist) + (track.album ? ' · ' + esc(track.album) : '') + '</div>' +
            '</div>' +
            '<div class="track-when"' + dataUnix + '>' + whenText + '</div>' +
            '</li>';
    }

    function renderTrackList() {
        var tracks = state.tracks;
        if (!tracks) return '<p class="muted">couldn&#39;t load last.fm history right now.</p>';
        var pastTracks = tracks.filter(function (t) { return !t.nowPlaying; });
        var groups = groupConsecutiveTracks(pastTracks).slice(0, state.recentTracksMax);
        if (groups.length === 0) return '<p class="muted">no recent listens.</p>';
        var visible = groups.slice(0, state.tracksVisible);
        return '<ul class="track-list">' + visible.map(renderTrackRow).join('') + '</ul>';
    }

    function updateLanyard() {
        var el = document.getElementById('profileLanyard');
        if (el) el.innerHTML = renderLanyardCard(state.lanyard);
    }

    function updateNowPlaying() {
        var el = document.getElementById('profileNowPlaying');
        if (el) el.innerHTML = renderNowPlaying();
    }

    function updateTrackList() {
        var el = document.getElementById('profileTrackList');
        if (el) el.innerHTML = renderTrackList();
        updateTrackLoadMore();
    }

    function updateTrackLoadMore() {
        var btn = document.getElementById('loadMoreTracks');
        var wrap = document.getElementById('loadMoreTracksWrap');
        if (!btn) return;
        var tracks = state.tracks;
        if (!tracks) { if (wrap) wrap.style.display = 'none'; return; }
        var pastTracks = tracks.filter(function (t) { return !t.nowPlaying; });
        var groups = groupConsecutiveTracks(pastTracks).slice(0, state.recentTracksMax);
        if (state.tracksVisible >= groups.length) {
            if (wrap) wrap.style.display = 'none';
        } else {
            if (wrap) wrap.style.display = '';
            btn.textContent = 'load more (' + (groups.length - state.tracksVisible) + ' left)';
        }
    }

    function updateClock() {
        state.now = Date.now();

        var r = computeNowPlaying();
        if (r.spotifyLive) {
            var fill = document.getElementById('spotifyProgressFill');
            var elapsed = document.getElementById('spotifyElapsed');
            if (fill && elapsed) {
                var progress = spotifyProgress(r.spotifyLive, state.now);
                fill.style.width = progress + '%';
                var sec = Math.min(
                    (r.spotifyLive.timestamps.end - r.spotifyLive.timestamps.start) / 1000,
                    Math.max(0, (state.now - r.spotifyLive.timestamps.start) / 1000)
                );
                elapsed.textContent = formatClock(sec);
            }
        }

        var whenEls = document.querySelectorAll('.track-when[data-unix]');
        for (var i = 0; i < whenEls.length; i++) {
            var unix = parseInt(whenEls[i].dataset.unix, 10);
            if (unix) whenEls[i].textContent = relativeTime(unix, state.now);
        }
    }

    function pollLanyard() {
        fetch('/api/lanyard', { cache: 'no-store' }).then(function (res) {
            if (!res.ok) return;
            return res.json();
        }).then(function (data) {
            if (!data || !data.profile || data.cachedAt === undefined) return;
            if (data.cachedAt <= state.lastLanyardAt) return;
            state.lastLanyardAt = data.cachedAt;
            state.lanyard = data.profile;
            updateLanyard();
            updateNowPlaying();
        }).catch(function () {});
    }

    function pollLastFm() {
        fetch('/api/last-fm/listening-history', { cache: 'no-store' }).then(function (res) {
            if (!res.ok) return;
            return res.json();
        }).then(function (data) {
            if (!data || !data.tracks || data.cachedAt === undefined) return;
            if (data.cachedAt <= state.lastTracksAt) return;
            state.lastTracksAt = data.cachedAt;
            state.tracks = data.tracks;
            updateNowPlaying();
            updateTrackList();
        }).catch(function () {});
    }

    function initWatchLoadMore() {
        var btn = document.getElementById('loadMoreWatch');
        if (!btn) return;
        var tiles = document.querySelectorAll('#watchGrid .watch-tile');
        var watchVisible = parseInt(btn.dataset.initialVisible || '6', 10);

        function refresh() {
            for (var i = 0; i < tiles.length; i++) {
                tiles[i].style.display = i < watchVisible ? '' : 'none';
            }
            if (watchVisible >= tiles.length) {
                btn.style.display = 'none';
            } else {
                btn.style.display = '';
                btn.textContent = 'load more (' + (tiles.length - watchVisible) + ' left)';
            }
        }

        btn.addEventListener('click', function () {
            watchVisible += WATCH_STEP;
            refresh();
        });
        refresh();
    }

    function initTrackLoadMore() {
        var btn = document.getElementById('loadMoreTracks');
        if (!btn) return;
        btn.addEventListener('click', function () {
            state.tracksVisible += TRACKS_STEP;
            updateTrackList();
        });
    }

    function init() {
        state.now = Date.now();
        updateLanyard();
        updateNowPlaying();
        updateTrackList();
        initWatchLoadMore();
        initTrackLoadMore();

        setInterval(updateClock, CLOCK_TICK_MS);
        setInterval(pollLanyard, LANYARD_POLL_MS);
        setInterval(pollLastFm, LASTFM_POLL_MS);
        pollLanyard();
        pollLastFm();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
