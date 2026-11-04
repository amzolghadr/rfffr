const PLATFORM = "Sexiha";
const BASE = "https://sexiha.com";
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

function reqJson(url, referer) {
    const h = Object.assign({}, HDR, { "Accept": "application/json,*/*" });
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
        const href = (b.match(/href="([^"]+)"/i) || [])[1];
        if (!href) continue;
        const title = clean(
            (b.match(/title="([^"]*)"/i) || [])[1] ||
            (b.match(/alt="([^"]*)"/i) || [])[1]
        );
        if (!title) continue;
        const url = abs(dec(href));
        out.push({
            url: url,
            id: url.replace(/\/+$/, "").split("/").pop(),
            title: title,
            thumb: abs(dec((b.match(/data-main-thumb="([^"]*)"/i) || [])[1] ||
                (b.match(/<img[^>]+src="([^"]*)"/i) || [])[1] || "")),
            duration: dur((b.match(/class="[^"]*duration[^"]*"[^>]*>([^<]*)</i) || [])[1])
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
            new PlatformID(PLATFORM, "sexiha", source.config.id),
            "Sexiha", BASE, FALLBACK_THUMB
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

// --- file host resolvers ---
function resolveGofile(id) {
    const j = reqJson("https://api.gofile.io/contents/" + id + "?wt=4fd6sg89d7s6", "https://gofile.io/");
    if (!j || !j.data) return [];
    const kids = j.data.children || {};
    const out = [];
    for (const k in kids) if (kids[k].link) out.push(kids[k].link);
    if (!out.length && j.data.link) out.push(j.data.link);
    return out;
}

function resolvePixeldrain(id) {
    return ["https://pixeldrain.com/api/file/" + id];
}

function resolveDropbox(url) {
    return [url.replace(/[?&]dl=0/, "").replace(/\?$/, "") + (url.indexOf("?") >= 0 ? "&dl=1" : "?dl=1")];
}

function resolveHost(link) {
    try {
        const g = link.match(/gofile\.io\/d\/([A-Za-z0-9-]+)/);
        if (g) return resolveGofile(g[1]);
        const p = link.match(/pixeldrain\.com\/(?:u|file)\/([A-Za-z0-9]+)/);
        if (p) return resolvePixeldrain(p[1]);
        if (/dropbox\.com/.test(link)) return resolveDropbox(link);
        const html = req(link);
        const out = [];
        const re = /<source[^>]+src="([^"]+)"/gi;
        let m;
        while ((m = re.exec(html))) out.push(abs(dec(m[1])));
        const re2 = /(?:file|src|video_url)\s*[:=]\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi;
        while ((m = re2.exec(html))) out.push(m[1].startsWith("http") ? m[1] : abs(dec(m[1])));
        return out;
    } catch (e) { return []; }
}

function extractSources(html) {
    const out = [];
    const re = /<source[^>]+src="([^"]+)"/gi;
    let m;
    while ((m = re.exec(html))) out.push(abs(dec(m[1])));
    const re2 = /(?:video_url|file)\s*[:=]\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi;
    while ((m = re2.exec(html))) out.push(abs(dec(m[1])));
    if (!out.length) {
        const b = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
        if (b) out.push(b[0]);
    }
    if (!out.length) {
        const hosts = html.match(/https?:\/\/(?:gofile\.io|pixeldrain\.com|dropbox\.com)\/[^"'\s<>]+/gi) || [];
        for (const h of hosts.slice(0, 4)) out.push.apply(out, resolveHost(h));
    }
    return out.filter((v, i, a) => a.indexOf(v) === i);
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
    const u = BASE + "/page/" + page + "/?s=" + encodeURIComponent(query);
    const items = parseList(req(u)).map(videoObj);
    return new VideoPager(items, items.length > 0, String(page + 1));
};

source.getSearchSuggestions = function () { return []; };

source.isChannelUrl = function (url) { return /\/(category|actors|tags)\//i.test(url); };

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

source.isVideoUrl = function (url) { return /\/video\//i.test(url); };

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
            new PlatformID(PLATFORM, "sexiha", source.config.id),
            "Sexiha", BASE, FALLBACK_THUMB
        ),
        uploadDate: 0,
        duration: 0,
        viewCount: -1,
        url: url,
        isLive: false,
        description: new Description(desc, DescriptionType.PLAINTEXT),
        video: new VideoSourceDescriptor(
            srcs.map(s => new VideoUrlSource({ url: s, mimeType: s.indexOf(".m3u8") >= 0 ? "application/x-mpegURL" : "video/mp4" })),
            { "Referer": url }
        )
    });
};

source.getContentDetails = source.getVideoDetails;

source.getPlaybackSource = function (url) {
    const srcs = extractSources(req(url));
    if (!srcs.length) throw new ScriptException("No source found");
    return new VideoSourceDescriptor(
        srcs.map(s => new VideoUrlSource({ url: s, mimeType: s.indexOf(".m3u8") >= 0 ? "application/x-mpegURL" : "video/mp4" })),
        { "Referer": url }
    );
};
