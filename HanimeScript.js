const PLATFORM = "Hanime";
const BASE = "https://hanime.tv";
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

function isoDur(s) {
    if (!s) return 0;
    const m = String(s).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
    if (!m) return 0;
    return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

function parseList(html) {
    const out = [];
    const re = /<a\b[^>]*href="(\/videos\/hentai\/[^"]+)"[^>]*>/gi;
    let m;
    while ((m = re.exec(html))) {
        const tail = html.slice(m.index, m.index + 2500);
        const title = clean(
            (m[0].match(/title="([^"]*)"/i) || [])[1] ||
            (tail.match(/<img[^>]+alt="([^"]*)"/i) || [])[1] ||
            (tail.match(/class="[^"]*title[^"]*"[^>]*>([\s\S]*?)</i) || [])[1]
        );
        if (!title) continue;
        const thumb = abs(dec(
            (tail.match(/<img[^>]+src="([^"]+)"/i) || [])[1] ||
            (tail.match(/data-src="([^"]+)"/i) || [])[1] || ""
        ));
        const d = isoDur((tail.match(/"duration"\s*:\s*"(PT[^"]+)"/i) || [])[1] || "");
        const url = BASE + m[1];
        out.push({ url: url, id: m[1].split("/").pop(), title: title, thumb: thumb, duration: d });
    }
    return out;
}

function videoObj(v) {
    return new PlatformVideo({
        id: new PlatformID(PLATFORM, v.id, source.config.id),
        name: v.title,
        thumbnails: new Thumbnails([new Thumbnail(v.thumb || FALLBACK_THUMB, 0)]),
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, "hanime", source.config.id),
            "hanime", BASE, FALLBACK_THUMB
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
    const items = parseList(req(BASE + "/browse/trending")).map(videoObj);
    return new VideoPager(items, true, "2");
};

source.getSearchCapabilities = function () {
    return { types: [Type.Feed.Mixed], sorts: [Type.Order.Chronological], filters: [] };
};

source.search = function (query, type, order, filters, continuationToken) {
    const page = continuationToken ? parseInt(continuationToken) : 1;
    const u = BASE + "/search?query=" + encodeURIComponent(query) + "&page=" + page;
    const items = parseList(req(u)).map(videoObj);
    return new VideoPager(items, items.length > 0, String(page + 1));
};

source.getSearchSuggestions = function (query) { return []; };

source.isChannelUrl = function (url) { return /\/browse\/tags\//i.test(url); };

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
    const u = url.replace(/\/+$/, "") + "?page=" + page;
    const items = parseList(req(u)).map(videoObj);
    return new VideoPager(items, items.length > 0, String(page + 1));
};

source.isVideoUrl = function (url) { return /\/videos\/hentai\//i.test(url); };

function extractSources(html) {
    const out = [];
    const pairs = [];

    let re = /"height"\s*:\s*(\d+)[^{}]{0,400}?"url"\s*:\s*"([^"]+)"/gi;
    let m;
    while ((m = re.exec(html))) pairs.push({ h: parseInt(m[1]), u: m[2] });

    re = /"url"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"[^{}]{0,400}?"height"\s*:\s*(\d+)/gi;
    while ((m = re.exec(html))) pairs.push({ h: parseInt(m[2]), u: m[1] });

    re = /"src"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/gi;
    while ((m = re.exec(html))) pairs.push({ h: 0, u: m[1] });

    for (const p of pairs) {
        let u = dec(p.u);
        if (u.startsWith("//")) u = "https:" + u;
        if (!u.startsWith("http")) continue;
        out.push({ url: u, height: p.h || 0 });
    }

    if (!out.length) {
        re = /https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/gi;
        while ((m = re.exec(html))) out.push({ url: m[0], height: 0 });
    }

    const seen = {};
    return out.filter(s => {
        if (seen[s.url]) return false;
        seen[s.url] = 1;
        return true;
    }).sort((a, b) => b.height - a.height);
}

source.getVideoDetails = function (url) {
    const html = req(url);
    const title = clean(
        (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] ||
        (html.match(/property="og:title"\s+content="([^"]*)"/i) || [])[1]
    ) || "Untitled";
    const thumb = abs(dec((html.match(/property="og:image"\s+content="([^"]*)"/i) || [])[1] || ""));
    const desc = clean((html.match(/property="og:description"\s+content="([^"]*)"/i) || [])[1] || "");
    const d = isoDur((html.match(/"duration"\s*:\s*"(PT[^"]+)"/i) || [])[1] ||
        (html.match(/property="og:video:duration"\s+content="([^"]+)"/i) || [])[1] || "");
    const srcs = extractSources(html);
    const id = url.replace(/\/+$/, "").split("/").pop();

    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, id, source.config.id),
        name: title,
        thumbnails: new Thumbnails([new Thumbnail(thumb || FALLBACK_THUMB, 0)]),
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, "hanime", source.config.id),
            "hanime", BASE, FALLBACK_THUMB
        ),
        uploadDate: 0,
        duration: d,
        viewCount: -1,
        url: url,
        isLive: false,
        description: new Description(desc, DescriptionType.PLAINTEXT),
        video: new VideoSourceDescriptor(
            srcs.map(s => new VideoUrlSource({
                url: s.url,
                mimeType: s.url.indexOf(".m3u8") >= 0 ? "application/x-mpegURL" : "video/mp4",
                height: s.height || 0,
                name: s.height ? s.height + "p" : undefined
            })),
            { "Referer": BASE + "/" }
        )
    });
};

source.getContentDetails = source.getVideoDetails;

source.getPlaybackSource = function (url) {
    const srcs = extractSources(req(url));
    if (!srcs.length) throw new ScriptException("No source found");
    return new VideoSourceDescriptor(
        srcs.map(s => new VideoUrlSource({
            url: s.url,
            mimeType: s.url.indexOf(".m3u8") >= 0 ? "application/x-mpegURL" : "video/mp4",
            height: s.height || 0,
            name: s.height ? s.height + "p" : undefined
        })),
        { "Referer": BASE + "/" }
    );
};
