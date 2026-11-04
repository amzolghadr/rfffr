const PLATFORM = "Jendekhune";
const BASE = "https://jendekhune.com";
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

function reqSafe(url, referer) {
    try { return req(url, referer); } catch (e) { return ""; }
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
        const href = (b.match(/href="([^"]+)"/i) || [])[1];
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
        const url = abs(dec(href));
        out.push({ url: url, id: url.replace(/\/+$/, "").split("/").pop(), title: title, thumb: thumb, duration: 0 });
    }
    return out;
}

function videoObj(v) {
    return new PlatformVideo({
        id: new PlatformID(PLATFORM, v.id, source.config.id),
        name: v.title,
        thumbnails: new Thumbnails([new Thumbnail(v.thumb || FALLBACK_THUMB, 0)]),
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, "jendekhune", source.config.id),
            "Jendekhune", BASE, FALLBACK_THUMB
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

source.isChannelUrl = function (url) { return /\/(category|genre|tag)\//i.test(url); };

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
    return /jendekhune\.com\/[^\/]+\/?$/i.test(url) && !/\/(category|genre|tag|page)\//i.test(url);
};

// --- host resolvers ---
function resolveSendvid(html) {
    const out = [];
    const re = /<source[^>]+src="(https?:\/\/[^"]+\.mp4[^"]*)"/gi;
    let m;
    while ((m = re.exec(html))) out.push(dec(m[1]));
    if (!out.length) {
        const b = html.match(/https?:\/\/[^"'\s<>]*sendvid[^"'\s<>]*\.mp4[^"'\s<>]*/i);
        if (b) out.push(b[0]);
    }
    return out;
}

function resolveStreamtape(html) {
    const out = [];
    const a = html.match(/id="captchalink"[^>]*href="([^"]+)"/i);
    if (a) out.push(a[1].startsWith("http") ? a[1] : "https://streamtape.com" + a[1]);
    const re = /(\/get_video\?id=[^"'&\s]+&token=[^"'&\s]+)/gi;
    let m;
    while ((m = re.exec(html))) out.push("https://streamtape.com" + m[1]);
    const b = html.match(/https?:\/\/[^"'\s<>]+\.(?:mp4|m3u8)[^"'\s<>]*/i);
    if (!out.length && b) out.push(b[0]);
    return out;
}

function resolveGofile(link) {
    const g = link.match(/gofile\.io\/d\/([A-Za-z0-9-]+)/);
    if (!g) return [];
    const raw = reqSafe("https://api.gofile.io/contents/" + g[1] + "?wt=4fd6sg89d7s6", "https://gofile.io/");
    if (!raw) return [];
    let j;
    try { j = JSON.parse(raw); } catch (e) { return []; }
    if (!j || !j.data) return [];
    const kids = j.data.children || {};
    const out = [];
    for (const k in kids) if (kids[k].link) out.push(kids[k].link);
    if (!out.length && j.data.link) out.push(j.data.link);
    return out;
}

function resolveBunkr(link) {
    const html = reqSafe(link);
    if (!html) return [];
    const out = [];
    const re = /<source[^>]+src="([^"]+)"/gi;
    let m;
    while ((m = re.exec(html))) out.push(abs(dec(m[1])));
    const b = html.match(/https?:\/\/[^"'\s<>]+\.(?:mp4|m3u8)[^"'\s<>]*/i);
    if (!out.length && b) out.push(b[0]);
    return out;
}

function resolveLulu(link) {
    const html = reqSafe(link);
    if (!html) return [];
    const out = [];
    const re = /(?:file|src)\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi;
    let m;
    while ((m = re.exec(html))) out.push(m[1].startsWith("http") ? m[1] : abs(dec(m[1])));
    const re2 = /<source[^>]+src="([^"]+)"/gi;
    while ((m = re2.exec(html))) out.push(abs(dec(m[1])));
    return out;
}

function resolveAny(link) {
    try {
        if (/sendvid\.com/.test(link)) return resolveSendvid(reqSafe(link));
        if (/streamtape\.com/.test(link)) return resolveStreamtape(reqSafe(link));
        if (/gofile\.io/.test(link)) return resolveGofile(link);
        if (/bunkr\./.test(link)) return resolveBunkr(link);
        if (/lulustream\.com/.test(link)) return resolveLulu(link);
        if (/vidara\./.test(link)) return resolveBunkr(link);
        const html = reqSafe(link);
        if (!html) return [];
        const out = [];
        const re = /<source[^>]+src="([^"]+)"/gi;
        let m;
        while ((m = re.exec(html))) out.push(abs(dec(m[1])));
        const b = html.match(/https?:\/\/[^"'\s<>]+\.(?:mp4|m3u8)[^"'\s<>]*/i);
        if (!out.length && b) out.push(b[0]);
        return out;
    } catch (e) { return []; }
}

function serverLinks(html) {
    const out = [];
    const idx = html.indexOf("data-sources");
    if (idx < 0) return out;
    const slice = html.slice(idx, idx + 6000);
    const re = /"([^"]*https?:\\?\/\\?\/[^"]+)"/g;
    let m;
    while ((m = re.exec(slice))) {
        const u = m[1].replace(/\\\//g, "/");
        if (/\.(?:jpg|png|webp|css|js)$/i.test(u)) continue;
        out.push(u);
    }
    return out.filter((v, i, a) => a.indexOf(v) === i).slice(0, 8);
}

function extractSources(html) {
    let out = [];
    const re = /<source[^>]+src="([^"]+)"/gi;
    let m;
    while ((m = re.exec(html))) out.push(abs(dec(m[1])));

    const hosts = serverLinks(html);
    for (const h of hosts) out.push.apply(out, resolveAny(h));

    if (!out.length) {
        const b = html.match(/https?:\/\/[^"'\s<>]+\.(?:mp4|m3u8)[^"'\s<>]*/i);
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
    const srcs = extractSources(html);
    const id = url.replace(/\/+$/, "").split("/").pop();

    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, id, source.config.id),
        name: title,
        thumbnails: new Thumbnails([new Thumbnail(thumb || FALLBACK_THUMB, 0)]),
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, "jendekhune", source.config.id),
            "Jendekhune", BASE, FALLBACK_THUMB
        ),
        uploadDate: 0,
        duration: 0,
        viewCount: -1,
        url: url,
        isLive: false,
        description: new Description(desc, DescriptionType.PLAINTEXT),
        video: new VideoSourceDescriptor(
            srcs.map(s => new VideoUrlSource({
                url: s,
                mimeType: s.indexOf(".m3u8") >= 0 ? "application/x-mpegURL" : "video/mp4"
            })),
            { "Referer": url }
        )
    });
};

source.getContentDetails = source.getVideoDetails;

source.getPlaybackSource = function (url) {
    const srcs = extractSources(req(url));
    if (!srcs.length) throw new ScriptException("No source found");
    return new VideoSourceDescriptor(
        srcs.map(s => new VideoUrlSource({
            url: s,
            mimeType: s.indexOf(".m3u8") >= 0 ? "application/x-mpegURL" : "video/mp4"
        })),
        { "Referer": url }
    );
};
