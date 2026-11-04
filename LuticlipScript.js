const PLATFORM = "Luticlip";
const BASE = "https://luticlip.com";
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
        .replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&#039;/g, "'")
        .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ");
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
    const blocks = html.split(/<article\b/i).slice(1);
    for (const b of blocks) {
        const href = (b.match(/href="([^"]*\/video\/[^"]*)"/i) || [])[1];
        if (!href) continue;
        const title = clean(
            (b.match(/title="([^"]*)"/i) || [])[1] ||
            (b.match(/alt="([^"]*)"/i) || [])[1] ||
            (b.match(/<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1]
        );
        if (!title) continue;
        const thumb = abs(dec(
            (b.match(/data-main-thumb="([^"]*)"/i) || [])[1] ||
            (b.match(/data-src="([^"]*)"/i) || [])[1] ||
            (b.match(/<img[^>]+src="([^"]*)"/i) || [])[1] || ""
        ));
        const d = dur((b.match(/class="[^"]*duration[^"]*"[^>]*>([^<]*)</i) || [])[1]);
        const url = abs(dec(href));
        out.push({ url, id: url.split("/").filter(Boolean).pop(), title, thumb, duration: d });
    }
    return out;
}

function videoObj(v) {
    return new PlatformVideo({
        id: new PlatformID(PLATFORM, v.id, source.config.id),
        name: v.title,
        thumbnails: new Thumbnails([new Thumbnail(v.thumb || FALLBACK_THUMB, 0)]),
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, "luticlip", source.config.id),
            "Luticlip", BASE, FALLBACK_THUMB
        ),
        uploadDate: v.uploadDate || 0,
        duration: v.duration || 0,
        viewCount: -1,
        url: v.url,
        isLive: false
    });
}

function pageUrl(baseUrl, page, filter) {
    let u = baseUrl.replace(/\/+$/, "") + "/";
    if (page > 1) u += "page/" + page + "/";
    if (filter) u += "?filter=" + filter;
    return u;
}

source.enable = function (conf, settings, savedState) {
    source.config = conf || {};
    source.settings = settings || {};
    source.savedState = savedState;
};

source.getHome = function () {
    const html = req(BASE + "/");
    const items = parseList(html).map(videoObj);
    return new VideoPager(items, true, "2");
};

source.getSearchCapabilities = function () {
    return { types: [Type.Feed.Mixed], sorts: [Type.Order.Chronological], filters: [] };
};

source.search = function (query, type, order, filters, continuationToken) {
    const page = continuationToken ? parseInt(continuationToken) : 1;
    const u = BASE + "/page/" + page + "/?s=" + encodeURIComponent(query);
    const html = req(u);
    const items = parseList(html).map(videoObj);
    return new VideoPager(items, items.length > 0, String(page + 1));
};

source.getSearchSuggestions = function (query) { return []; };

source.isChannelUrl = function (url) {
    return /\/(category|actors|channels)\//i.test(url);
};

source.getChannelCapabilities = function () {
    return { types: [Type.Feed.Mixed], sorts: [Type.Order.Chronological], filters: [] };
};

source.getChannel = function (url) {
    const slug = url.replace(/\/+$/, "").split("/").pop();
    const name = dec(slug.replace(/-/g, " "));
    return new PlatformChannel({
        id: new PlatformID(PLATFORM, slug, source.config.id),
        name: name,
        thumbnail: FALLBACK_THUMB,
        banner: FALLBACK_THUMB,
        subscribers: -1,
        url: url
    });
};

source.getChannelContents = function (url, type, order, filters, continuationToken) {
    const page = continuationToken ? parseInt(continuationToken) : 1;
    const html = req(pageUrl(url, page));
    const items = parseList(html).map(videoObj);
    return new VideoPager(items, items.length > 0, String(page + 1));
};

source.isVideoUrl = function (url) { return /\/video\//i.test(url); };

function extractSources(html) {
    const out = [];
    const re = /<source[^>]+src="([^"]+)"/gi;
    let m;
    while ((m = re.exec(html))) out.push(abs(dec(m[1])));
    if (!out.length) {
        const a = html.match(/video_url\s*[:=]\s*["']([^"']+)["']/i);
        if (a) out.push(abs(dec(a[1])));
    }
    if (!out.length) {
        const b = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
        if (b) out.push(b[0]);
    }
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
    const d = dur((html.match(/property="og:video:duration"\s+content="(\d+)"/i) || [])[1] || "");
    const srcs = extractSources(html);
    const id = url.replace(/\/+$/, "").split("/").pop();

    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, id, source.config.id),
        name: title,
        thumbnails: new Thumbnails([new Thumbnail(thumb || FALLBACK_THUMB, 0)]),
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, "luticlip", source.config.id),
            "Luticlip", BASE, FALLBACK_THUMB
        ),
        uploadDate: 0,
        duration: d,
        viewCount: -1,
        url: url,
        isLive: false,
        description: new Description(desc, DescriptionType.PLAINTEXT),
        video: new VideoSourceDescriptor(
            srcs.map(s => new VideoUrlSource({ url: s, mimeType: "video/mp4" })),
            { "Referer": url }
        )
    });
};

source.getContentDetails = source.getVideoDetails;

source.getPlaybackSource = function (url) {
    const html = req(url);
    const srcs = extractSources(html);
    if (!srcs.length) throw new ScriptException("No source found");
    return new VideoSourceDescriptor(
        srcs.map(s => new VideoUrlSource({ url: s, mimeType: "video/mp4" })),
        { "Referer": url }
    );
};
