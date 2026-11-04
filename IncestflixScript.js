const PLATFORM = "Incestflix";
const BASE = "https://incestflix.com.co";
const FALLBACK_THUMB = BASE + "/favicon.ico";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HDR = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9"
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

function dur(t) {
    if (!t) return 0;
    const p = String(t).trim().split(":").map(Number);
    if (!p.length || p.some(isNaN)) return 0;
    let s = 0;
    for (const x of p) s = s * 60 + x;
    return s;
}

function parseList(html) {
    const out = [];
    const re = /<a\b[^>]*class="[^"]*\bvideo\b[^"]*"[^>]*>/gi;
    let m;
    while ((m = re.exec(html))) {
        const tag = m[0];
        const href = (tag.match(/href="([^"]+)"/i) || [])[1];
        if (!href) continue;
        const bg = (tag.match(/background-image\s*:\s*url\(\s*['"]?([^'")]+)/i) || [])[1];
        const tail = html.slice(m.index, m.index + 2000);
        const title = clean(
            (tag.match(/title="([^"]*)"/i) || [])[1] ||
            (tail.match(/<span[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] ||
            (tail.match(/<img[^>]+alt="([^"]*)"/i) || [])[1]
        );
        if (!title) continue;
        const url = abs(dec(href));
        out.push({
            url: url,
            id: url.replace(/\/+$/, "").split("/").pop(),
            title: title,
            thumb: abs(dec(bg || "")),
            duration: dur((tail.match(/class="[^"]*duration[^"]*"[^>]*>([^<]*)</i) || [])[1])
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
            new PlatformID(PLATFORM, "incestflix", source.config.id),
            "Incestflix", BASE, FALLBACK_THUMB
        ),
        uploadDate: 0,
        duration: v.duration || 0,
        viewCount: -1,
        url: v.url,
        isLive: false
    });
}

function pageUrl(baseUrl, page) {
    let u = baseUrl.replace(/\/+$/, "") + "/";
    if (page > 1) u += "page/" + page + "/";
    return u;
}

source.enable = function (conf, settings, savedState) {
    source.config = conf || {};
    source.settings = settings || {};
    source.savedState = savedState;
};

source.getHome = function () {
    const items = parseList(req(BASE + "/")).map(videoObj);
    return new VideoPager(items, true, "2");
};

source.getSearchCapabilities = function () {
    return { types: [Type.Feed.Mixed], sorts: [Type.Order.Chronological], filters: [] };
};

source.search = function (query, type, order, filters, continuationToken) {
    const page = continuationToken ? parseInt(continuationToken) : 1;
    const u = BASE + "/?s=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : "");
    const items = parseList(req(u)).map(videoObj);
    return new VideoPager(items, items.length > 0, String(page + 1));
};

source.getSearchSuggestions = function () { return []; };

source.isChannelUrl = function (url) {
    return /\/(category|models|studio|topic)\//i.test(url);
};

source.getChannelCapabilities = function () {
    return { types: [Type.Feed.Mixed], sorts: [Type.Order.Chronological], filters: [] };
};

source.getChannel = function (url) {
    const slug = url.replace(/\/+$/, "").split("/").pop();
    return new PlatformChannel({
        id: new PlatformID(PLATFORM, slug, source.config.id),
        name: dec(slug.replace(/-/g, " ")),
        thumbnail: FALLBACK_THUMB,
        banner: FALLBACK_THUMB,
        subscribers: -1,
        url: url
    });
};

source.getChannelContents = function (url, type, order, filters, continuationToken) {
    const page = continuationToken ? parseInt(continuationToken) : 1;
    const items = parseList(req(pageUrl(url, page))).map(videoObj);
    return new VideoPager(items, items.length > 0, String(page + 1));
};

source.isVideoUrl = function (url) {
    const m = String(url).match(/incestflix\.com\.co\/([^\/?#]+)/i);
    if (!m) return false;
    return !/^(category|models|studio|topic|page|search|feed)$/i.test(m[1]);
};

function scan(html) {
    const out = [];
    let m;
    let re = /<source[^>]+src=["']([^"']+)["']/gi;
    while ((m = re.exec(html))) out.push(abs(dec(m[1])));
    re = /<video[^>]+src=["']([^"']+)["']/gi;
    while ((m = re.exec(html))) out.push(abs(dec(m[1])));
    re = /(?:video_url|videoUrl|videoSrc|file|source|src)\s*[:=]\s*["']([^"']+\.(?:mp4|m3u8|webm)[^"']*)["']/gi;
    while ((m = re.exec(html))) out.push(abs(dec(m[1])));
    re = /(?:data-[a-z-]+)=["'](https?:\/\/[^"']+\.(?:mp4|m3u8|webm)[^"']*)["']/gi;
    while ((m = re.exec(html))) out.push(m[1]);
    re = /https?:\/\/[^"'\s<>\\]+\.(?:mp4|m3u8|webm)(?:\?[^"'\s<>\\]*)?/gi;
    while ((m = re.exec(html))) out.push(m[0]);
    return out;
}

function embeds(html) {
    const out = [];
    let m;
    let re = /<iframe[^>]+src=["']([^"']+)["']/gi;
    while ((m = re.exec(html))) out.push(abs(dec(m[1])));
    re = /(?:data-src|data-embed|data-video)=["']([^"']+)["']/gi;
    while ((m = re.exec(html))) {
        const u = abs(dec(m[1]));
        if (!/\.(?:mp4|m3u8|jpg|png|webp)$/i.test(u)) out.push(u);
    }
    return out.filter((v, i, a) => a.indexOf(v) === i && !/incestflix\.com\.co\/[^\/]+\/?$/i.test(v)).slice(0, 3);
}

function extractSources(html) {
    let out = scan(html);
    if (!out.length) {
        for (const e of embeds(html)) {
            try {
                const inner = req(e, BASE + "/");
                out = out.concat(scan(inner));
            } catch (err) { }
        }
    }
    return out.filter((v, i, a) => a.indexOf(v) === i);
}

function descriptor(srcs, referer) {
    const d = new VideoSourceDescriptor(srcs.map(s => new VideoUrlSource({
        url: s,
        mimeType: s.indexOf(".m3u8") >= 0 ? "application/x-mpegURL" : "video/mp4"
    })));
    try { d.headers = { "Referer": referer }; } catch (e) { }
    return d;
}

source.getVideoDetails = function (url) {
    const html = req(url);
    const title = clean(
        (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] ||
        (html.match(/property="og:title"\s+content="([^"]*)"/i) || [])[1]
    ) || "Untitled";
    const thumb = abs(dec((html.match(/property="og:image"\s+content="([^"]*)"/i) || [])[1] || ""));
    const desc = clean((html.match(/property="og:description"\s+content="([^"]*)"/i) || [])[1] || "");
    const srcs = extractSources(html);
    const id = url.replace(/\/+$/, "").split("/").pop();

    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, id, source.config.id),
        name: title,
        thumbnails: new Thumbnails([new Thumbnail(thumb || FALLBACK_THUMB, 0)]),
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, "incestflix", source.config.id),
            "Incestflix", BASE, FALLBACK_THUMB
        ),
        uploadDate: 0,
        duration: 0,
        viewCount: -1,
        url: url,
        isLive: false,
        description: new Description(desc, DescriptionType.PLAINTEXT),
        video: descriptor(srcs, url)
    });
};

source.getContentDetails = source.getVideoDetails;

source.getPlaybackSource = function (url) {
    const srcs = extractSources(req(url));
    if (!srcs.length) throw new ScriptException("No source found");
    return descriptor(srcs, url);
};
