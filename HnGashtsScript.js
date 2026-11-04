const PLATFORM = "HnGashts";
const BASE = "https://hn-gashts.com";
const FALLBACK_THUMB = BASE + "/favicon.ico";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HDR = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "fa,en;q=0.8"
};

function req(url, referer) {
    const h = Object.assign({}, HDR);
    if (referer) h["Referer"] = referer;
    let res;
    try { res = http.GET(url, h); } catch (e) { throw new ScriptException("GET failed: " + url); }
    const body = res && typeof res === "object" ? res.body : res;
    if (!body) throw new ScriptException("Empty body: " + url);
    return String(body);
}

function reqJson(url, referer) {
    const h = Object.assign({}, HDR, { "Accept": "application/json,*/*", "X-Requested-With": "XMLHttpRequest" });
    if (referer) h["Referer"] = referer;
    let res;
    try { res = http.GET(url, h); } catch (e) { return null; }
    const body = res && typeof res === "object" ? res.body : res;
    if (!body) return null;
    try { return JSON.parse(String(body)); } catch (e) { return null; }
}

function abs(u) {
    if (!u) return "";
    u = u.trim();
    if (u.startsWith("http")) return u;
    if (u.startsWith("//")) return "https:" + u;
    return BASE + (u.startsWith("/") ? u : "/" + u);
}

function dec(s) {
    return String(s || "")
        .replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

function clean(s) { return dec(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); }

function parseList(html) {
    const out = [];
    const blocks = html.split(/<article\b/i).slice(1);
    for (const b of blocks) {
        const href = (b.match(/href="(https?:\/\/[^"]*hn-gashts\.com\/[^"]+)"/i) || [])[1];
        if (!href) continue;
        const title = clean(
            (b.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i) || [])[1] ||
            (b.match(/title="([^"]*)"/i) || [])[1] ||
            (b.match(/alt="([^"]*)"/i) || [])[1]
        );
        if (!title) continue;
        const thumb = abs(dec(
            (b.match(/<img[^>]+src="([^"]+)"/i) || [])[1] ||
            (b.match(/data-src="([^"]+)"/i) || [])[1] || ""
        ));
        out.push({
            url: href,
            id: href.replace(/\/+$/, "").split("/").pop(),
            title: title,
            thumb: thumb,
            duration: 0
        });
    }
    return out;
}

function videoObj(v) {
    return new PlatformVideo({
        id: new PlatformID(PLATFORM, v.id, source.config.id),
        name: v.title,
        thumbnails: new Thumbnails([new Thumbnail(v.thumb || FALLBACK_THUMB, 0)]),
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, "hn-gashts", source.config.id),
            "HN-Gashts", BASE, FALLBACK_THUMB
        ),
        uploadDate: 0,
        duration: v.duration || 0,
        viewCount: -1,
        url: v.url,
        isLive: false
    });
}

source.enable = function (conf, settings, savedState) {
    source.config = conf || {};
    source.settings = settings || {};
    source.savedState = savedState;
};

source.getHome = function () {
    const items = parseList(req(BASE + "/category/anime/")).map(videoObj);
    return new VideoPager(items, true, "2");
};

source.getSearchCapabilities = function () {
    return { types: [Type.Feed.Mixed], sorts: [Type.Order.Chronological], filters: [] };
};

source.search = function (query, type, order, filters, continuationToken) {
    const page = continuationToken ? parseInt(continuationToken) : 1;
    const u = BASE + "/page/" + page + "/?s=" + encodeURIComponent(query);
    const items = parseList(req(u)).map(videoObj);
    return new VideoPager(items, items.length > 0, String(page + 1));
};

source.getSearchSuggestions = function () { return []; };

source.isChannelUrl = function (url) { return /\/(category|genre)\//i.test(url); };

source.getChannelCapabilities = function () {
    return { types: [Type.Feed.Mixed], sorts: [Type.Order.Chronological], filters: [] };
};

source.getChannel = function (url) {
    const slug = url.replace(/\/+$/, "").split("/").pop();
    return new PlatformChannel({
        id: new PlatformID(PLATFORM, slug, source.config.id),
        name: dec(decodeURIComponent(slug).replace(/-/g, " ")),
        thumbnail: FALLBACK_THUMB,
        banner: FALLBACK_THUMB,
        subscribers: -1,
        url: url
    });
};

source.getChannelContents = function (url, type, order, filters, continuationToken) {
    const page = continuationToken ? parseInt(continuationToken) : 1;
    const u = url.replace(/\/+$/, "") + "/page/" + page + "/";
    const items = parseList(req(u)).map(videoObj);
    return new VideoPager(items, items.length > 0, String(page + 1));
};

source.isVideoUrl = function (url) {
    return /hn-gashts\.com\/[^\/]+\/?$/i.test(url) && !/\/(category|genre|page)\//i.test(url);
};

function qualityRows(html) {
    const out = [];
    const re = /data-quality="([^"]+)"[\s\S]{0,600}?<\/div>/gi;
    let m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out;
}

function downloadLinks(html) {
    const out = [];
    const re = /href="(https?:\/\/dl\.hn-gashts\.com\/[^"]+\.(?:mkv|mp4))"/gi;
    let m;
    while ((m = re.exec(html))) out.push(dec(m[1]));
    const re2 = /(https?:\/\/dl\.hn-gashts\.com\/[^"'\s<>]+\.(?:mkv|mp4))/gi;
    while ((m = re2.exec(html))) out.push(m[1]);
    const re3 = /<source[^>]+src="([^"]+)"/gi;
    while ((m = re3.exec(html))) out.push(abs(dec(m[1])));
    return out.filter((v, i, a) => a.indexOf(v) === i);
}

source.getVideoDetails = function (url) {
    const html = req(url);
    const title = clean(
        (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] ||
        (html.match(/property="og:title"\s+content="([^"]*)"/i) || [])[1]
    ) || "Untitled";
    const thumb = abs(dec((html.match(/property="og:image"\s+content="([^"]*)"/i) || [])[1] || ""));
    const desc = clean((html.match(/property="og:description"\s+content="([^"]*)"/i) || [])[1] || "");
    const qualities = qualityRows(html);

    let srcs = downloadLinks(html);

    if (!srcs.length) {
        const pid = (html.match(/data-post(?:-id)?="(\d+)"/i) || [])[1] ||
            (html.match(/postid-(\d+)/i) || [])[1];
        if (pid) {
            const tries = [
                BASE + "/wp-json/hng-dl/v1/links?post=" + pid,
                BASE + "/wp-json/hng-dl/v1/links?id=" + pid,
                BASE + "/wp-json/hng-dl/v1/link?post=" + pid
            ];
            for (const t of tries) {
                const j = reqJson(t, url);
                if (!j) continue;
                const found = JSON.stringify(j).match(/https?:\\?\/\\?\/dl\.hn-gashts\.com[^"\\]+/g);
                if (found) {
                    srcs = found.map(s => s.replace(/\\\//g, "/"));
                    break;
                }
            }
        }
    }

    const id = url.replace(/\/+$/, "").split("/").pop();

    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, id, source.config.id),
        name: title,
        thumbnails: new Thumbnails([new Thumbnail(thumb || FALLBACK_THUMB, 0)]),
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, "hn-gashts", source.config.id),
            "HN-Gashts", BASE, FALLBACK_THUMB
        ),
        uploadDate: 0,
        duration: 0,
        viewCount: -1,
        url: url,
        isLive: false,
        description: new Description(
            desc + (qualities.length ? "\n\nکیفیت‌ها: " + qualities.join(", ") : ""),
            DescriptionType.PLAINTEXT
        ),
        video: new VideoSourceDescriptor(
            srcs.map(s => new VideoUrlSource({
                url: s,
                mimeType: s.endsWith(".mkv") ? "video/x-matroska" : "video/mp4",
                name: (s.match(/(\d{3,4})p/) || [])[1] ? (s.match(/(\d{3,4})p/) || [])[1] + "p" : undefined
            })),
            { "Referer": url }
        )
    });
};

source.getContentDetails = source.getVideoDetails;

source.getPlaybackSource = function (url) {
    const html = req(url);
    const srcs = downloadLinks(html);
    if (!srcs.length) throw new ScriptException("No source found");
    return new VideoSourceDescriptor(
        srcs.map(s => new VideoUrlSource({
            url: s,
            mimeType: s.endsWith(".mkv") ? "video/x-matroska" : "video/mp4"
        })),
        { "Referer": url }
    );
};
