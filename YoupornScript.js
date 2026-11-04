const PLATFORM = "YouPorn";
const BASE_URL = "https://www.youporn.com";
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Cookie": "age_verified=1; platform=pc"
};

let config = {};

source.enable = function (conf) {
    config = conf ?? {};
};

source.getHome = function () {
    return new YpPager(`${BASE_URL}/browse/time/`, 1, "home", "");
};

source.searchSuggestions = function (query) {
    return [];
};

source.getSearchCapabilities = function () {
    return { types: [Type.Feed.Mixed], sorts: [Type.Order.Chronological], filters: [] };
};

source.search = function (query, type, order, filters) {
    return new YpPager(`${BASE_URL}/search/`, 1, "search", query);
};

source.isContentDetailsUrl = function (url) {
    return /^https?:\/\/(www\.)?youporn\.com\/watch\//.test(url);
};

source.getContentDetails = function (url) {
    const html = http.GET(url, HEADERS, false).body;

    const title = decodeEntities(grab(html, /<meta property="og:title" content="(.*?)"/)) || "YouPorn video";
    const thumb = grab(html, /<meta property="og:image" content="(.*?)"/);
    const duration = parseInt(grab(html, /"video_duration"\s*:\s*"?(\d+)"?/) || grab(html, /"duration"\s*:\s*"?(\d+)"?/) || "0");

    const sources = [];
    const defs = extractMediaDefinitions(html);

    for (const def of defs) {
        if (!def.videoUrl) continue;
        const defUrl = def.videoUrl.startsWith("http") ? def.videoUrl : BASE_URL + def.videoUrl;

        if (def.format === "hls") {
            sources.push(new HLSSource({ name: "HLS " + qualityLabel(def.quality), url: defUrl, duration: duration, priority: true }));
        } else if (def.format === "mp4") {
            // mp4 definitions usually point to an endpoint that returns a JSON list of qualities
            try {
                const list = JSON.parse(http.GET(defUrl, HEADERS, false).body);
                for (const item of list) {
                    if (!item.videoUrl) continue;
                    const h = parseInt(item.quality) || 0;
                    sources.push(new VideoUrlSource({
                        name: h ? h + "p" : "MP4",
                        url: item.videoUrl,
                        width: Math.round(h * 16 / 9),
                        height: h,
                        container: "video/mp4",
                        codec: "avc1",
                        bitrate: 0,
                        duration: duration
                    }));
                }
            } catch (e) {
                log("mp4 definition lookup failed: " + e);
            }
        }
    }

    if (sources.length === 0) {
        throw new ScriptException("No playable sources found on this page");
    }

    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, url, config.id),
        name: title,
        thumbnails: new Thumbnails(thumb ? [new Thumbnail(thumb, 0)] : []),
        author: new PlatformAuthorLink(new PlatformID(PLATFORM, "youporn", config.id), "YouPorn", BASE_URL, ""),
        datetime: 0,
        duration: duration,
        viewCount: 0,
        url: url,
        isLive: false,
        description: "",
        video: new VideoSourceDescriptor(sources)
    });
};

class YpPager extends VideoPager {
    constructor(baseUrl, page, mode, query) {
        const result = loadPage(baseUrl, page, mode, query);
        super(result.videos, result.hasMore, { baseUrl, page, mode, query });
    }

    nextPage() {
        return new YpPager(this.context.baseUrl, this.context.page + 1, this.context.mode, this.context.query);
    }
}

function loadPage(baseUrl, page, mode, query) {
    let url;
    if (mode === "search") {
        url = `${baseUrl}?query=${encodeURIComponent(query)}&page=${page}`;
    } else {
        url = page > 1 ? `${baseUrl}?page=${page}` : baseUrl;
    }

    const resp = http.GET(url, HEADERS, false);
    if (!resp.isOk) {
        return { videos: [], hasMore: false };
    }

    const dom = domParser.parseFromString(resp.body, "text/html");
    const boxes = dom.querySelectorAll(".video-box");
    const videos = [];

    for (const box of boxes) {
        const link = box.querySelector("a.video-box-image") || box.querySelector("a[href^='/watch/']");
        if (!link) continue;

        const href = link.getAttribute("href");
        if (!href || href.indexOf("/watch/") < 0) continue;

        const videoUrl = href.startsWith("http") ? href : BASE_URL + href;
        const img = box.querySelector("img");
        const thumb = img ? (img.getAttribute("data-original") || img.getAttribute("data-src") || img.getAttribute("src")) : "";
        const titleNode = box.querySelector(".video-title-text") || box.querySelector(".video-box-title");
        const durNode = box.querySelector(".video-duration");

        videos.push(new PlatformVideo({
            id: new PlatformID(PLATFORM, videoUrl, config.id),
            name: titleNode ? titleNode.text.trim() : "YouPorn video",
            thumbnails: new Thumbnails(thumb ? [new Thumbnail(thumb, 0)] : []),
            author: new PlatformAuthorLink(new PlatformID(PLATFORM, "youporn", config.id), "YouPorn", BASE_URL, ""),
            datetime: 0,
            duration: durNode ? parseClock(durNode.text) : 0,
            viewCount: 0,
            url: videoUrl,
            isLive: false
        }));
    }

    return { videos: videos, hasMore: videos.length > 0 };
}

function extractMediaDefinitions(html) {
    const m = html.match(/"mediaDefinitions?"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
    if (!m) return [];
    try {
        return JSON.parse(m[1]);
    } catch (e) {
        log("mediaDefinitions parse failed: " + e);
        return [];
    }
}

function qualityLabel(q) {
    if (Array.isArray(q)) return q.join("/") + "p";
    return q ? q + "p" : "auto";
}

function parseClock(text) {
    const parts = (text || "").trim().split(":").map(function (p) { return parseInt(p) || 0; });
    let total = 0;
    for (const p of parts) total = total * 60 + p;
    return total;
}

function decodeEntities(s) {
    return (s || "").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function grab(text, regex) {
    const m = text.match(regex);
    return m ? m[1] : "";
}
