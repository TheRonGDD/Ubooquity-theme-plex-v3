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
    var userName = document.body.getAttribute('data-user-name') || 'public_usr';
    return 'plex-v3-continue-reading:v2:' + userName;
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

function plexV3FetchBookmarkForCurrentUser(itemId) {
    var rootPath = document.body.getAttribute('data-root-path') || '';
    return fetch(rootPath + '/user-api/bookmark?docId=' + encodeURIComponent(itemId), {
        credentials: 'same-origin'
    }).then(function (response) {
        if (response.status === 204) {
            return '';
        }

        if (!response.ok) {
            return '';
        }

        return response.text();
    }).catch(function () {
        return '';
    });
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
        var candidates = Object.keys(itemsById)
            .map(function (itemId) {
                return itemsById[itemId];
            })
            .sort(function (a, b) {
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
                    return {
                        item: item,
                        bookmark: (bookmark || '').trim()
                    };
                });
            })
        ).then(function (results) {
            var cards = results
                .filter(function (result) {
                    return result.bookmark && result.bookmark !== '0' && result.bookmark !== '0#0';
                })
                .map(function (result) {
                    return result.item.html;
                })
                .slice(0, 18);

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

function plexV3BuildHomeRows() {
    var latestRows = Array.prototype.slice.call(document.querySelectorAll('[data-dynamic-row="latest"]'));
    if (!latestRows.length) {
        return;
    }

    Promise.all(
        latestRows.map(function (row) {
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
        })
    ).then(function () {
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
    }
});
