const PLATFORM = "XNXX";
const BASE_URL = "https://www.xnxx.com";
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
};

let config = {};

source.enable = function (conf) {
    config = conf ?? {};
};

source.getHome = function () {
    return new XnxxPager(`${BASE_URL}/best/${currentMonth()}`, 0, "home");
};

source.searchSuggestions = function (query) {
    return [];
};

source.getSearchCapabilities = function () {
    return { types: [Type.Feed.Mixed], sorts: [Type.Order.Chronological], filters: [] };
};

source.search = function (query, type, order, filters) {
    return new XnxxPager(`${BASE_URL}/search/${encodeURIComponent(query)}`, 0, "search");
};

source.isContentDetailsUrl = function (url) {
    return /^https?:\/\/(www\.)?xnxx\.com\/video-/.test(url);
};

source.getContentDetails = function (url) {
    const html = http.GET(url, HEADERS, false).body;

    const title = grab(html, /setVideoTitle\('(.*?)'\)/) || "XNXX video";
    const thumb = grab(html, /setThumbUrl169\('(.*?)'\)/) || grab(html, /setThumbUrl\('(.*?)'\)/);
    const low = grab(html, /setVideoUrlLow\('(.*?)'\)/);
    const high = grab(html, /setVideoUrlHigh\('(.*?)'\)/);
    const hls = grab(html, /setVideoHLS\('(.*?)'\)/);
    const duration = parseInt(grab(html, /"duration"\s*:\s*"?(\d+)"?/) || "0");

    const sources = [];
    if (hls) {
        sources.push(new HLSSource({ name: "HLS (auto)", url: hls, duration: duration, priority: true }));
    }
    if (high) {
        sources.push(new VideoUrlSource({ name: "High", url: high, width: 1280, height: 720, container: "video/mp4", codec: "avc1", bitrate: 0, duration: duration }));
    }
    if (low) {
        sources.push(new VideoUrlSource({ name: "Low", url: low, width: 640, height: 360, container: "video/mp4", codec: "avc1", bitrate: 0, duration: duration }));
    }

    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, url, config.id),
        name: title,
        thumbnails: new Thumbnails(thumb ? [new Thumbnail(thumb, 0)] : []),
        author: new PlatformAuthorLink(new PlatformID(PLATFORM, "xnxx", config.id), "XNXX", BASE_URL, ""),
        datetime: 0,
        duration: duration,
        viewCount: 0,
        url: url,
        isLive: false,
        description: "",
        video: new VideoSourceDescriptor(sources)
    });
};

class XnxxPager extends VideoPager {
    constructor(baseUrl, page, mode) {
        const result = loadPage(baseUrl, page, mode);
        super(result.videos, result.hasMore, { baseUrl, page, mode });
    }

    nextPage() {
        return new XnxxPager(this.context.baseUrl, this.context.page + 1, this.context.mode);
    }
}

function loadPage(baseUrl, page, mode) {
    const url = page > 0 ? `${baseUrl}/${page}` : baseUrl;
    const resp = http.GET(url, HEADERS, false);
    if (!resp.isOk) {
        return { videos: [], hasMore: false };
    }

    const dom = domParser.parseFromString(resp.body, "text/html");
    const blocks = dom.querySelectorAll("div.thumb-block");
    const videos = [];

    for (const block of blocks) {
        const link = block.querySelector(".thumb-under p a");
        if (!link) continue;

        const href = link.getAttribute("href");
        if (!href || href.indexOf("/video-") < 0) continue;

        const videoUrl = href.startsWith("http") ? href : BASE_URL + href;
        const img = block.querySelector("img");
        const thumb = img ? (img.getAttribute("data-src") || img.getAttribute("src")) : "";
        const meta = block.querySelector(".metadata");
        const metaText = meta ? meta.text : "";

        videos.push(new PlatformVideo({
            id: new PlatformID(PLATFORM, videoUrl, config.id),
            name: link.getAttribute("title") || link.text,
            thumbnails: new Thumbnails(thumb ? [new Thumbnail(thumb, 0)] : []),
            author: new PlatformAuthorLink(new PlatformID(PLATFORM, "xnxx", config.id), "XNXX", BASE_URL, ""),
            datetime: 0,
            duration: parseDuration(metaText),
            viewCount: 0,
            url: videoUrl,
            isLive: false
        }));
    }

    return { videos: videos, hasMore: videos.length > 0 };
}

function parseDuration(text) {
    if (!text) return 0;
    let total = 0;
    const h = text.match(/(\d+)\s*h/);
    const m = text.match(/(\d+)\s*min/);
    const s = text.match(/(\d+)\s*sec/);
    if (h) total += parseInt(h[1]) * 3600;
    if (m) total += parseInt(m[1]) * 60;
    if (s) total += parseInt(s[1]);
    return total;
}

function grab(text, regex) {
    const m = text.match(regex);
    return m ? m[1] : "";
}

function currentMonth() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

console.log("XNXX plugin loaded");
