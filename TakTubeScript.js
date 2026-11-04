const BASE = "https://www.taktube.net";
const PLATFORM = "TakTube";
const PLUGIN_ID = "b3f7c2a1-9d4e-4a6b-8c15-7e2f9a0d3c64";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const FALLBACK_THUMB = "https://www.taktube.net/content/uploads/2024/10/favicon-32x32-1.png";

let config = {};

source.enable = function (conf) {
    config = conf ?? {};
};

// ---------- helpers ----------
function get(url) {
    const res = http.GET(url, {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fa,en;q=0.8"
    }, false);
    if (!res.isOk) throw new ScriptException("Request failed (" + res.code + "): " + url);
    return res.body;
}

function decode(s) {
    return (s || "")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

function absolute(u) {
    if (!u) return "";
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return BASE + u;
    return u;
}

function toSeconds(text) {
    if (!text) return 0;
    const parts = String(text).trim().split(":").map(Number);
    if (parts.some(isNaN)) return 0;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function isoToSeconds(iso) {
    if (!iso) return 0;
    const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/.exec(iso);
    if (!m) return 0;
    return (parseInt(m[1] || 0) * 86400) + (parseInt(m[2] || 0) * 3600) + (parseInt(m[3] || 0) * 60) + Math.round(parseFloat(m[4] || 0));
}

function idFromUrl(url) {
    const m = /\/post-(\d+)/.exec(url);
    if (m) return m[1];
    const m2 = /\/(\d{4})\/(\d{2})\/([^\/]+)\//.exec(url);
    if (m2) return m2[1] + m2[2] + "-" + decodeURIComponent(m2[3]);
    return url;
}

const AUTHOR = new PlatformAuthorLink(
    new PlatformID(PLATFORM, "taktube", PLUGIN_ID),
    "TakTube", BASE + "/", null
);

// ---------- listing ----------
function parseListing(html) {
    const results = [];
    const seen = {};
    const artRe = /<article\b[^>]*data-main-thumb="([^"]*)"[^>]*>([\s\S]*?)<\/article>/gi;
    let m;
    while ((m = artRe.exec(html)) !== null) {
        const thumb = decode(m[1]);
        const inner = m[2];
        const link = /<a[^>]+href="([^"]+)"[^>]*title="([^"]*)"/i.exec(inner);
        if (!link) continue;
        const url = absolute(decode(link[1]));
        if (seen[url]) continue;
        seen[url] = true;

        let title = decode(link[2]).trim();
        if (!title) {
            const alt = /alt="([^"]+)"/i.exec(inner);
            title = alt ? decode(alt[1]).trim() : "Video";
        }

        const durText = /<span class="duration">([\s\S]*?)<\/span>/i.exec(inner);
        const duration = durText ? toSeconds(decode(durText[1]).replace(/<[^>]+>/g, "").trim()) : 0;

        results.push(new PlatformVideo({
            id: new PlatformID(PLATFORM, idFromUrl(url), PLUGIN_ID),
            name: title,
            thumbnails: new Thumbnails([new Thumbnail(thumb || FALLBACK_THUMB, 0)]),
            author: AUTHOR,
            datetime: 0,
            duration: duration,
            viewCount: 0,
            url: url,
            isLive: false
        }));
    }
    return results;
}

class ListingPager extends VideoPager {
    constructor(results, hasMore, urlBuilder, page) {
        super(results, hasMore, { urlBuilder, page });
    }
    nextPage() {
        return getListing(this.context.urlBuilder, this.context.page + 1);
    }
}

function getListing(urlBuilder, page) {
    const results = parseListing(get(urlBuilder(page)));
    return new ListingPager(results, results.length > 0, urlBuilder, page);
}

// ---------- home ----------
source.getHome = function () {
    return getListing((p) => (p <= 1 ? BASE + "/" : BASE + "/page/" + p + "/"), 1);
};

// ---------- search ----------
source.getSearchSuggestions = function (query) { return []; };
source.searchSuggestions = function (query) { return []; };

source.getSearchCapabilities = function () {
    return { types: [Type.Feed.Mixed], sorts: [], filters: [] };
};

source.getSearchChannelContentsCapabilities = function () {
    return { types: [Type.Feed.Mixed], sorts: [], filters: [] };
};

source.search = function (query, type, order, filters) {
    const q = encodeURIComponent((query || "").trim());
    const builder = (p) => (p <= 1 ? BASE + "/?s=" + q : BASE + "/page/" + p + "/?s=" + q);
    const results = parseListing(get(builder(1)));
    return new ContentPager(results, results.length > 0, { urlBuilder: builder, page: 1 });
};

// ---------- channels (categories / tags / actors) ----------
source.getChannelCapabilities = function () {
    return { types: [Type.Feed.Mixed], sorts: [], filters: [] };
};

source.getChannel = function (url) {
    const path = url.replace(BASE, "");
    let name = "TakTube";
    const cat = /\/category\/([^\/]+)/.exec(path);
    const tag = /\/tag\/([^\/]+)/.exec(path);
    const actor = /\/actor\/([^\/]+)/.exec(path);
    if (cat) name = decodeURIComponent(cat[1]).replace(/-/g, " ");
    else if (tag) name = "#" + decodeURIComponent(tag[1]).replace(/-/g, " ");
    else if (actor) name = decodeURIComponent(actor[1]).replace(/-/g, " ");
    return new PlatformChannel({
        id: new PlatformID(PLATFORM, path, PLUGIN_ID),
        name: name,
        thumbnail: null,
        banner: null,
        subscribers: 0,
        description: "",
        url: url
    });
};

source.getChannelContents = function (url, type, order, filters) {
    const base = url.replace(/\/$/, "");
    return getListing((p) => (p <= 1 ? base + "/" : base + "/page/" + p + "/"), 1);
};

// ---------- details ----------
source.isContentDetailsUrl = function (url) {
    return /taktube\.net\/\d{4}\/\d{2}\/[^\/]+\/?$/i.test(url);
};

source.getContentDetails = function (url) {
    const html = get(url);

    const title = decode(
        (/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i.exec(html) || [])[1] ||
        (/<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1] ||
        (/<title>([^<]*)<\/title>/i.exec(html) || [])[1] || "Video"
    ).trim();

    const thumb = decode(
        (/<meta[^>]+itemprop="thumbnailUrl"[^>]+content="([^"]*)"/i.exec(html) ||
         /<meta[^>]+property="og:image"[^>]+content="([^"]*)"/i.exec(html) || [])[1] || ""
    );

    const description = decode(
        (/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i.exec(html) || [])[1] || ""
    ).trim();

    let videoUrl = decode(
        (/<meta[^>]+itemprop="contentUrl"[^>]+content="([^"]*)"/i.exec(html) ||
         /<video[^>]+src="([^"]+\.mp4[^"]*)"/i.exec(html) ||
         /<source[^>]+src="([^"]+\.mp4[^"]*)"/i.exec(html) ||
         /(https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*)/i.exec(html) || [])[1] || ""
    );
    if (!videoUrl) throw new ScriptException("No video source found on page");
    videoUrl = absolute(videoUrl);

    const duration = isoToSeconds((/<meta[^>]+itemprop="duration"[^>]+content="([^"]*)"/i.exec(html) || [])[1])
        || toSeconds(((/<span class="duration">([\s\S]*?)<\/span>/i.exec(html) || ["", ""])[1] || "").replace(/<[^>]+>/g, "").trim());

    const upload = (/<meta[^>]+itemprop="uploadDate"[^>]+content="([^"]*)"/i.exec(html) || [])[1];
    const datetime = upload ? Math.floor(new Date(upload).getTime() / 1000) : 0;

    const authors = [AUTHOR];
    const actorBlock = /<div id="video-actors">([\s\S]*?)<\/div>/i.exec(html);
    if (actorBlock) {
        const actorRe = /<a[^>]+href="([^"]*\/actor\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let am;
        while ((am = actorRe.exec(actorBlock[1])) !== null) {
            const aUrl = absolute(am[1]);
            authors.push(new PlatformAuthorLink(
                new PlatformID(PLATFORM, aUrl, PLUGIN_ID),
                decode(am[2]).trim(), aUrl, null
            ));
        }
    }

    const tags = [];
    const tagRe = /<a[^>]+href="[^"]*\/(?:tag|category)\/[^"]*"[^>]*title="([^"]*)"/gi;
    let tm;
    while ((tm = tagRe.exec(html)) !== null) {
        const t = decode(tm[1]).trim();
        if (t && tags.indexOf(t) === -1) tags.push(t);
    }

    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, idFromUrl(url), PLUGIN_ID),
        name: title,
        thumbnails: new Thumbnails([new Thumbnail(thumb || FALLBACK_THUMB, 0)]),
        author: AUTHOR,
        datetime: datetime,
        duration: duration,
        viewCount: 0,
        url: url,
        isLive: false,
        description: description,
        video: new VideoSourceDescriptor([
            new VideoUrlSource({
                name: "MP4",
                width: 0,
                height: 0,
                container: "video/mp4",
                codec: "avc1",
                bitrate: 0,
                duration: duration,
                url: videoUrl
            })
        ]),
        rating: new RatingLikes(0),
        subtitles: [],
        hashtags: tags,
        getContentRecommendations: (u) => getRecommendations(u)
    });
};

// ---------- recommendations ----------
function getRecommendations(url) {
    let html = "";
    try { html = get(url); } catch (e) { return new ContentPager([], false); }
    const block = /<div class="under-video-block">([\s\S]*?)<\/div>\s*<div class="clear">/i.exec(html);
    const results = parseListing(block ? block[1] : html);
    return new ContentPager(results, false);
}

source.getContentRecommendations = function (url) {
    return getRecommendations(url);
};
