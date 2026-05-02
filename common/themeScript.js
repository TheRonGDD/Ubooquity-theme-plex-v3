function plexV3ToggleSidebar() {
    document.body.classList.toggle('sidebar-collapsed');
    try {
        localStorage.setItem(
            'plex-v3-sidebar-collapsed',
            document.body.classList.contains('sidebar-collapsed') ? '1' : '0'
        );
    } catch (e) {
    }
    return false;
}

var plexV3ContinueRefreshPending = false;
var plexV3LastHomeRefreshAt = 0;
var plexV3MinHomeRefreshIntervalMs = 30000;
var plexV3LibraryGridRefreshing = false;
var plexV3LastLibraryGridRefreshAt = 0;
var plexV3MinLibraryGridRefreshIntervalMs = 5000;

function plexV3NormalizeCard(card) {
    var clone = card.cloneNode(true);
    clone.classList.add('home-row-card');

    var thumb = clone.querySelector('.thumb');
    if (thumb) {
        thumb.removeAttribute('style');
    }

    var image = clone.querySelector('img');
    if (image) {
        image.removeAttribute('width');
        image.removeAttribute('height');
        image.removeAttribute('style');
    }

    return clone;
}

function plexV3NormalizeUrl(url, baseUrl) {
    try {
        return new URL(url, baseUrl || window.location.href).href;
    } catch (e) {
        return url;
    }
}

function plexV3GetProgressValue(card) {
    var progress = card.querySelector('.cover_progress_bar_fill');
    if (!progress) {
        return 0;
    }

    var value = progress.style.getPropertyValue('--value') || '';
    if (!value) {
        return 0;
    }

    return parseFloat(String(value).replace('%', '')) || 0;
}

function plexV3ExtractItemId(card) {
    var link = card.querySelector('.poster-cell .thumb');
    if (!link) {
        return '';
    }

    var onclick = link.getAttribute('onclick') || '';
    var match = onclick.match(/loadBookDetails\((\d+),/);
    return match ? match[1] : '';
}

function plexV3GetContinueCacheKey() {
    var userName =
        document.body.getAttribute('data-user-name') ||
        localStorage.getItem('plex-v3-current-user') ||
        'public_usr';
    return 'plex-v3-continue-reading:v2:' + userName;
}

function plexV3GetTrackedContinueKey() {
    var userName =
        document.body.getAttribute('data-user-name') ||
        localStorage.getItem('plex-v3-current-user') ||
        'public_usr';
    return 'plex-v3-continue-tracked:v1:' + userName;
}

function plexV3LoadTrackedContinueReading() {
    try {
        var raw = localStorage.getItem(plexV3GetTrackedContinueKey());
        if (!raw) {
            return {};
        }

        var parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
        return {};
    }
}

function plexV3SaveTrackedContinueReading(items) {
    try {
        localStorage.setItem(plexV3GetTrackedContinueKey(), JSON.stringify(items || {}));
    } catch (e) {
    }
}

function plexV3OpenTrackedItem(thumb) {
    if (!thumb) {
        return;
    }
    var itemId = thumb.getAttribute('data-item-id');
    var rootPath = document.body.getAttribute('data-root-path') || '';
    if (typeof togglePopup === 'function') {
        togglePopup('bookdetails');
    }
    if (typeof loadBookDetails === 'function') {
        loadBookDetails(itemId, rootPath);
    }
}

function plexV3BuildTrackedCardHtml(item) {
    var itemIdStr = String(item.itemId || '').replace(/[^0-9]/g, '');

    var article = document.createElement('article');
    article.className = 'cellcontainer home-row-card';

    var cell = document.createElement('div');
    cell.className = 'cell poster-cell';

    var thumb = document.createElement('a');
    thumb.className = 'thumb';
    thumb.href = '#';
    thumb.setAttribute('data-item-id', itemIdStr);
    thumb.setAttribute('onclick', 'plexV3OpenTrackedItem(this);return false;');

    var image = document.createElement('img');
    if (item.coverUrl) {
        image.src = item.coverUrl;
    }
    image.alt = item.title || '';
    thumb.appendChild(image);

    var mask = document.createElement('div');
    mask.className = 'reading-mask plex-v3-loading status_inprogress';
    var fill = document.createElement('span');
    fill.className = 'cover_progress_bar_fill';
    fill.style.setProperty('--value', '0%');
    mask.appendChild(fill);
    thumb.appendChild(mask);

    cell.appendChild(thumb);

    var label = document.createElement('div');
    label.className = 'label';
    label.textContent = item.title || '';
    cell.appendChild(label);

    article.appendChild(cell);

    return article.outerHTML;
}

function plexV3TrackContinueReading(itemId, readerUrl, title, coverUrl) {
    if (!itemId) {
        return;
    }

    var items = plexV3LoadTrackedContinueReading();
    items[String(itemId)] = {
        itemId: String(itemId),
        readerUrl: readerUrl || '',
        title: title || '',
        coverUrl: coverUrl || '',
        updatedAt: Date.now()
    };
    plexV3SaveTrackedContinueReading(items);
}

function plexV3RemoveTrackedContinueReading(itemId) {
    if (!itemId) {
        return;
    }

    var items = plexV3LoadTrackedContinueReading();
    delete items[String(itemId)];
    plexV3SaveTrackedContinueReading(items);
}

function plexV3RenderContinueReading(cards, fallbackText) {
    var continueStrip = document.querySelector('[data-dynamic-row="continue-reading"] .row-strip');
    if (!continueStrip) {
        return;
    }

    continueStrip.classList.remove('row-strip-loading');
    continueStrip.textContent = '';

    if (!cards || !cards.length) {
        continueStrip.textContent = fallbackText || 'No active reading items found.';
        return;
    }

    cards.forEach(function (card) {
        if (typeof card === 'string') {
            var wrapper = document.createElement('div');
            wrapper.innerHTML = card;
            if (wrapper.firstElementChild) {
                continueStrip.appendChild(wrapper.firstElementChild);
            }
            return;
        }

        continueStrip.appendChild(plexV3NormalizeCard(card));
    });
}

function plexV3LoadContinueReadingCache() {
    try {
        var raw = localStorage.getItem(plexV3GetContinueCacheKey());
        if (!raw) {
            return null;
        }

        var parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.cards) || !parsed.cards.length) {
            return null;
        }

        return parsed;
    } catch (e) {
        return null;
    }
}

function plexV3SaveContinueReadingCache(cards) {
    try {
        localStorage.setItem(
            plexV3GetContinueCacheKey(),
            JSON.stringify({
                updatedAt: Date.now(),
                cards: cards
            })
        );
    } catch (e) {
    }
}

function plexV3CollectContinueReadingFromPage(doc, pageUrl, itemsById, queue, visited) {
    var cards = Array.prototype.slice.call(doc.querySelectorAll('.poster-grid .cellcontainer'));
    cards.forEach(function (card) {
        var itemId = plexV3ExtractItemId(card);
        if (!itemId || itemsById[itemId]) {
            return;
        }

        var progressValue = plexV3GetProgressValue(card);
        if (progressValue <= 0) {
            return;
        }

        itemsById[itemId] = {
            itemId: itemId,
            progress: progressValue,
            html: plexV3NormalizeCard(card).outerHTML
        };
    });

    Array.prototype.slice.call(doc.querySelectorAll('.folder-cell .thumb[href]')).forEach(function (link) {
        var href = plexV3NormalizeUrl(link.getAttribute('href'), pageUrl);
        if (!href || visited[href]) {
            return;
        }
        queue.push(href);
    });

    var nextLink = doc.querySelector('.nav-button-next[href]');
    var nextHref = nextLink ? plexV3NormalizeUrl(nextLink.getAttribute('href'), pageUrl) : '';
    if (nextHref && !visited[nextHref]) {
        var className = nextLink.className || '';
        if (className.indexOf('deactivate') === -1 && className.indexOf('disabled') === -1) {
            queue.push(nextHref);
        }
    }
}

function plexV3FetchDetailsProgress(itemId) {
    var rootPath = document.body.getAttribute('data-root-path') || '';
    return fetch(rootPath + '/bookdetails/' + encodeURIComponent(itemId), {
        credentials: 'same-origin',
        cache: 'no-store'
    }).then(function (response) {
        if (!response.ok) {
            return null;
        }
        return response.text();
    }).then(function (html) {
        if (!html) {
            return null;
        }
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var wrapper = doc.querySelector('#details_progress_wrapper');
        if (!wrapper) {
            return null;
        }
        var fill = wrapper.querySelector('.details_progress_bar_fill');
        var rawValue = fill ? (fill.style.getPropertyValue('--value') || '').trim() : '';
        return {
            value: rawValue,
            statusClass: (wrapper.className || '').trim()
        };
    }).catch(function () {
        return null;
    });
}

// `/user-api/bookmark?docId=...` is the only Ubooquity endpoint confirmed to be
// per-user-scoped (its handler reads User.getName() and falls back to public_usr).
// `/bookdetails/{id}` reads progress from OpusEntry.getBookmark(), whose join is
// not username-scoped, so it can leak another user's progress. Use this as the
// Continue Reading membership filter.
function plexV3FetchBookmarkForCurrentUser(itemId) {
    var rootPath = document.body.getAttribute('data-root-path') || '';
    return fetch(rootPath + '/user-api/bookmark?docId=' + encodeURIComponent(itemId), {
        credentials: 'same-origin',
        cache: 'no-store'
    }).then(function (response) {
        if (response.status === 204 || !response.ok) {
            return '';
        }
        return response.text();
    }).then(function (text) {
        return (text || '').trim();
    }).catch(function () {
        return '';
    });
}

function plexV3UserHasBookmark(bookmark) {
    var trimmed = (bookmark || '').trim();
    if (!trimmed) {
        return false;
    }
    if (trimmed === '0' || trimmed === '0#0') {
        return false;
    }
    return true;
}

// `/user-api/bookmark` returns a position string only, with no status field — a
// book "marked finished" still has a bookmark at the end-of-content position, so
// the bookmark gate alone can't drop finished items. Use `/bookdetails/{id}`'s
// statusClass as a secondary filter. This statusClass is from the unscoped
// OpusEntry.getBookmark() join so it can occasionally reflect another user's
// status; in the worst case a current-user in-progress item gets hidden because
// another user finished it, which is rarer than the inverse and acceptable.
function plexV3PassesContinueReadingFilter(result) {
    if (!result.hasBookmark) {
        return false;
    }
    var statusClass = result.detailsProgress ? result.detailsProgress.statusClass : '';
    if (statusClass.indexOf('finished') !== -1) {
        return false;
    }
    return true;
}

function plexV3ApplyProgressToCardHtml(html, value, statusClass) {
    var wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    var card = wrapper.firstElementChild;
    if (!card) {
        return html;
    }

    var mask = card.querySelector('.reading-mask');
    if (mask) {
        mask.className = ('reading-mask ' + (statusClass || '')).trim();
    }

    var fill = card.querySelector('.cover_progress_bar_fill');
    if (fill && value) {
        fill.style.setProperty('--value', value);
    }

    return card.outerHTML;
}

function plexV3BuildContinueReading(seedUrls) {
    var cached = plexV3LoadContinueReadingCache();
    if (cached) {
        plexV3RenderContinueReading(cached.cards);
    }

    var queue = [];
    var visited = Object.create(null);
    var itemsById = Object.create(null);
    var maxPages = 120;
    var maxItems = 24;
    var pagesVisited = 0;

    seedUrls.forEach(function (url) {
        var normalizedUrl = plexV3NormalizeUrl(url);
        if (normalizedUrl && !visited[normalizedUrl]) {
            queue.push(normalizedUrl);
        }
    });

    function finalize() {
        var trackedItems = plexV3LoadTrackedContinueReading();
        Object.keys(trackedItems).forEach(function (itemId) {
            if (itemsById[itemId]) {
                return;
            }

            itemsById[itemId] = {
                itemId: itemId,
                progress: 0,
                pinned: true,
                html: plexV3BuildTrackedCardHtml(trackedItems[itemId])
            };
        });

        var candidates = Object.keys(itemsById)
            .map(function (itemId) {
                return itemsById[itemId];
            })
            .sort(function (a, b) {
                if (a.pinned !== b.pinned) {
                    return a.pinned ? -1 : 1;
                }
                return b.progress - a.progress;
            });

        if (!candidates.length) {
            if (!cached) {
                plexV3RenderContinueReading([], 'No active reading items found yet.');
            }
            return;
        }

        Promise.all(
            candidates.slice(0, 36).map(function (item) {
                return plexV3FetchBookmarkForCurrentUser(item.itemId).then(function (bookmark) {
                    var hasBookmark = plexV3UserHasBookmark(bookmark);
                    if (!hasBookmark) {
                        return { item: item, hasBookmark: false, detailsProgress: null };
                    }
                    return plexV3FetchDetailsProgress(item.itemId).then(function (detailsProgress) {
                        return { item: item, hasBookmark: true, detailsProgress: detailsProgress };
                    });
                });
            })
        ).then(function (results) {
            var cards = results
                .filter(plexV3PassesContinueReadingFilter)
                .map(function (result) {
                    if (result.detailsProgress) {
                        return plexV3ApplyProgressToCardHtml(
                            result.item.html,
                            result.detailsProgress.value,
                            result.detailsProgress.statusClass
                        );
                    }
                    return result.item.html;
                })
                .slice(0, 18);

            Object.keys(trackedItems).forEach(function (itemId) {
                if (!results.some(function (result) {
                    return result.item.itemId === itemId && plexV3PassesContinueReadingFilter(result);
                })) {
                    delete trackedItems[itemId];
                }
            });
            plexV3SaveTrackedContinueReading(trackedItems);

            if (cards.length) {
                plexV3SaveContinueReadingCache(cards);
                plexV3RenderContinueReading(cards);
                return;
            }

            if (!cached) {
                plexV3RenderContinueReading([], 'No active reading items found yet.');
            }
        });
    }

    function next() {
        if (!queue.length || pagesVisited >= maxPages || Object.keys(itemsById).length >= maxItems) {
            finalize();
            return;
        }

        var url = queue.shift();
        if (!url || visited[url]) {
            next();
            return;
        }

        visited[url] = true;
        pagesVisited += 1;

        fetch(url, { credentials: 'same-origin' })
            .then(function (response) {
                return response.text();
            })
            .then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');
                plexV3CollectContinueReadingFromPage(doc, url, itemsById, queue, visited);
            })
            .catch(function () {
            })
            .finally(function () {
                next();
            });
    }

    next();
}

function plexV3RefreshHomeRows() {
    if (!document.body.classList.contains('page-home')) {
        return;
    }

    if (plexV3ContinueRefreshPending) {
        return;
    }

    var sinceLast = Date.now() - plexV3LastHomeRefreshAt;
    if (sinceLast < plexV3MinHomeRefreshIntervalMs) {
        return;
    }

    plexV3ContinueRefreshPending = true;
    window.setTimeout(function () {
        plexV3ContinueRefreshPending = false;
        plexV3LastHomeRefreshAt = Date.now();
        plexV3BuildHomeRows();
    }, 250);
}

function plexV3LoadLatestRow(row) {
    var url = row.getAttribute('data-source-url');
    return fetch(url, { credentials: 'same-origin' })
            .then(function (response) {
                return response.text();
            })
            .then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');
                var cards = Array.prototype.slice.call(doc.querySelectorAll('.poster-grid .cellcontainer')).slice(0, 12);
                var strip = row.querySelector('.row-strip');
                strip.classList.remove('row-strip-loading');
                strip.textContent = '';

                if (!cards.length) {
                    strip.textContent = 'No items';
                    return [];
                }

                cards.forEach(function (card) {
                    strip.appendChild(plexV3NormalizeCard(card));
                });
                return cards;
            })
            .catch(function () {
                var strip = row.querySelector('.row-strip');
                strip.classList.remove('row-strip-loading');
                strip.textContent = 'Unavailable';
                return [];
            });
}

function plexV3BuildHomeRows() {
    var latestRows = Array.prototype.slice.call(document.querySelectorAll('[data-dynamic-row="latest"]'));
    if (!latestRows.length) {
        return;
    }

    plexV3LastHomeRefreshAt = Date.now();

    var continueStrip = document.querySelector('[data-dynamic-row="continue-reading"] .row-strip');
    if (continueStrip && !continueStrip.textContent.trim()) {
        continueStrip.classList.add('row-strip-loading');
        continueStrip.textContent = 'Loading...';
    }

    Promise.all(latestRows.map(plexV3LoadLatestRow)).then(function () {
        var seedUrls = [];

        Array.prototype.slice.call(document.querySelectorAll('.home-sidebar .sidebar-link[data-category-id]')).forEach(function (link) {
            if (link.href) {
                seedUrls.push(link.href);
            }
        });

        latestRows.forEach(function (row) {
            var url = row.getAttribute('data-source-url');
            if (url) {
                seedUrls.push(url);
            }
        });

        plexV3BuildContinueReading(seedUrls);
    });
}

function plexV3ApplyDetailsProgressToCard(card, detailsProgress) {
    if (!card || !detailsProgress) {
        return;
    }
    var mask = card.querySelector('.reading-mask');
    if (mask) {
        mask.className = ('reading-mask ' + (detailsProgress.statusClass || '')).trim();
    }
    var fill = card.querySelector('.cover_progress_bar_fill');
    if (fill && detailsProgress.value) {
        fill.style.setProperty('--value', detailsProgress.value);
    }
}

function plexV3RefreshLibraryGridProgress() {
    if (!document.body.classList.contains('page-library')) {
        return;
    }
    if (plexV3LibraryGridRefreshing) {
        return;
    }

    var sinceLast = Date.now() - plexV3LastLibraryGridRefreshAt;
    if (plexV3LastLibraryGridRefreshAt && sinceLast < plexV3MinLibraryGridRefreshIntervalMs) {
        return;
    }

    var cards = Array.prototype.slice.call(document.querySelectorAll('.poster-grid .cellcontainer'));
    var queue = [];
    cards.forEach(function (card) {
        var itemId = plexV3ExtractItemId(card);
        if (itemId) {
            queue.push({ card: card, itemId: itemId });
        }
    });

    if (!queue.length) {
        return;
    }

    plexV3LibraryGridRefreshing = true;
    plexV3LastLibraryGridRefreshAt = Date.now();

    var index = 0;
    var concurrency = Math.min(6, queue.length);
    var inFlight = concurrency;

    function next() {
        if (index >= queue.length) {
            inFlight -= 1;
            if (inFlight <= 0) {
                plexV3LibraryGridRefreshing = false;
            }
            return;
        }
        var entry = queue[index++];
        plexV3FetchDetailsProgress(entry.itemId)
            .then(function (detailsProgress) {
                plexV3ApplyDetailsProgressToCard(entry.card, detailsProgress);
            })
            .catch(function () {
            })
            .then(next);
    }

    for (var i = 0; i < concurrency; i++) {
        next();
    }
}

function plexV3OnPageShow() {
    plexV3RefreshHomeRows();
    plexV3RefreshLibraryGridProgress();
}

function plexV3OnVisibilityChange() {
    if (!document.hidden) {
        plexV3RefreshHomeRows();
        plexV3RefreshLibraryGridProgress();
    }
}

function plexV3LinkIsActive(href) {
    if (!href) {
        return false;
    }

    var current = window.location.pathname.replace(/\/+$/, '');
    var target = href.replace(window.location.origin, '').replace(/\/+$/, '');

    return target && (current === target || current.indexOf(target + '/') === 0);
}

function plexV3PopulateGlobalSidebar() {
    var sidebars = Array.prototype.slice.call(document.querySelectorAll('[data-sidebar-dynamic]'));
    if (!sidebars.length) {
        return;
    }

    var rootPath = document.body.getAttribute('data-root-path') || '';
    fetch(rootPath + '/', { credentials: 'same-origin' })
        .then(function (response) {
            return response.text();
        })
        .then(function (html) {
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var homeBody = doc.querySelector('body');
            if (homeBody) {
                var currentUser = homeBody.getAttribute('data-user-name');
                if (currentUser) {
                    try {
                        localStorage.setItem('plex-v3-current-user', currentUser);
                    } catch (e) {
                    }
                }
            }
            var sourceLinks = Array.prototype.slice.call(doc.querySelectorAll('.home-sidebar .sidebar-nav .sidebar-link'));
            var logoutLink = doc.querySelector('.home-sidebar .sidebar-footer .sidebar-link');

            sidebars.forEach(function (sidebar) {
                var nav = sidebar.querySelector('.sidebar-nav');
                if (!nav) {
                    return;
                }

                var existingFooters = Array.prototype.slice.call(sidebar.querySelectorAll('.sidebar-footer'));
                existingFooters.forEach(function (footer) {
                    footer.parentNode.removeChild(footer);
                });

                nav.textContent = '';
                sourceLinks.forEach(function (link) {
                    var clone = link.cloneNode(true);
                    clone.classList.remove('active');
                    if (plexV3LinkIsActive(clone.getAttribute('href'))) {
                        clone.classList.add('active');
                    }
                    nav.appendChild(clone);
                });

                if (logoutLink) {
                    var footer = document.createElement('div');
                    footer.className = 'sidebar-footer';
                    footer.appendChild(logoutLink.cloneNode(true));
                    sidebar.appendChild(footer);
                }
            });
        })
        .catch(function () {
        });
}

function plexV3WireHomeSearch() {
    var homeSearchForm = document.getElementById('home-search-form');
    if (!homeSearchForm) {
        return;
    }

    homeSearchForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var target = document.getElementById('home-search-target');
        var input = document.getElementById('home-search-string');
        if (!target || !input || !target.value) {
            return;
        }
        homeSearchForm.action = target.value + '?search=simple';
        homeSearchForm.submit();
    });
}

document.addEventListener('DOMContentLoaded', function () {
    try {
        if (localStorage.getItem('plex-v3-sidebar-collapsed') === '1') {
            document.body.classList.add('sidebar-collapsed');
        }
    } catch (e) {
    }

    document.addEventListener('click', function (event) {
        var toggle = event.target.closest('[data-sidebar-toggle]');
        if (!toggle) {
            return;
        }
        event.preventDefault();
        plexV3ToggleSidebar();
    });

    plexV3PopulateGlobalSidebar();
    plexV3WireHomeSearch();

    if (document.body.classList.contains('page-home')) {
        plexV3BuildHomeRows();
        window.addEventListener('pageshow', plexV3OnPageShow);
        document.addEventListener('visibilitychange', plexV3OnVisibilityChange);
    }

    if (document.body.classList.contains('page-library')) {
        plexV3RefreshLibraryGridProgress();
        window.addEventListener('pageshow', plexV3OnPageShow);
        document.addEventListener('visibilitychange', plexV3OnVisibilityChange);
    }
});
