// =====================================
// Strict Hollywood Releases (90 days)
// TMDB + Region Filter (US, CA, GB)
// Safe for Vercel Serverless
// =====================================

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 90;

const REGIONS = ["US", "CA", "GB"];
const HOLLYWOOD_TYPES = [2, 3, 4, 6];
const MAX_PAGES = 5;       // Fetch 5 discover pages
const CONCURRENCY = 5;     // Limit TMDB sub-requests

// ----------------------
// CORS + JSON Response
// ----------------------
function cors(obj) {
    return new Response(
        typeof obj === "string" ? obj : JSON.stringify(obj),
        {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "*"
            }
        }
    );
}

// ----------------------
// Date helpers
// ----------------------
function daysAgo(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

// ----------------------
// Safe fetch (10s timeout)
// ----------------------
async function safeFetch(url) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);

    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        return null;
    }
}

// ----------------------
// Concurrency control
// ----------------------
async function pMap(list, fn, limit) {
    const out = new Array(list.length);
    let i = 0;

    async function worker() {
        while (i < list.length) {
            const idx = i++;
            try {
                out[idx] = await fn(list[idx], idx);
            } catch {
                out[idx] = null;
            }
        }
    }

    const workers = Array(Math.min(limit, list.length))
        .fill(0)
        .map(worker);

    await Promise.all(workers);
    return out;
}

// ----------------------
// Get Hollywood regional release date
// ----------------------
async function fetchRegionalDate(movieId) {
    const url =
        `https://api.themoviedb.org/3/movie/${movieId}/release_dates` +
        `?api_key=${TMDB_KEY}`;

    const data = await safeFetch(url);
    if (!data?.results) return null;

    for (const region of REGIONS) {
        const entry = data.results.find(r => r.iso_3166_1 === region);
        if (!entry) continue;

        const filtered = entry.release_dates
            .filter(r => HOLLYWOOD_TYPES.includes(r.type))
            .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

        if (filtered.length > 0) {
            return filtered[0].release_date.split("T")[0];
        }
    }

    return null;
}

// ----------------------
// Fetch movies (candidate list)
// ----------------------
async function fetchDiscoverPages() {
    let all = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
        const url =
            `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}` +
            `&language=en-US` +
            `&with_original_language=en` +
            `&sort_by=primary_release_date.desc` +
            `&primary_release_date.gte=${DATE_FROM}` +
            `&primary_release_date.lte=${DATE_TO}` +
            `&page=${page}`;

        const json = await safeFetch(url);
        if (!json?.results) break;

        all.push(...json.results);
    }

    return all;
}

// ----------------------
// Build final Hollywood list
// ----------------------
async function buildMovies() {
    const candidates = await fetchDiscoverPages();
    if (!candidates.length) return [];

    const results = await pMap(
        candidates,
        async (m) => {
            const rd = await fetchRegionalDate(m.id);
            if (!rd) return null;
            if (rd < DATE_FROM || rd > DATE_TO) return null;

            return {
                id: m.id.toString(),
                type: "movie",
                name: m.title,
                description: m.overview || "",
                poster: m.poster_path
                    ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
                    : null,
                background: m.backdrop_path
                    ? `https://image.tmdb.org/t/p/original${m.backdrop_path}`
                    : null,
                releaseDate: rd
            };
        },
        CONCURRENCY
    );

    // Remove nulls + sort newest first
    return results.filter(Boolean).sort(
        (a, b) => new Date(b.releaseDate) - new Date(a.releaseDate)
    );
}

// ----------------------
// Manifest
// ----------------------
const manifest = {
    id: "recent_movies",
    version: "1.0.0",
    name: "Recent Movie Releases (Hollywood)",
    description: "Theatrical / Digital / Streaming English movies from US, CA, GB in the last 90 days",
    types: ["movie"],
    catalogs: [
        {
            id: "recent_movies",
            type: "movie",
            name: "Hollywood Releases",
            extra: []
        }
    ]
};

// ----------------------
// Main handler
// ----------------------
export default async function handler(req) {

    // OPTIONS → CORS
    if (req.method === "OPTIONS")
        return cors("OK");

    // Safe URL parsing
    let base = "https://" + (req.headers.host || "localhost");
    let url;
    try {
        url = new URL(req.url, base);
    } catch {
        return cors({ error: "Invalid URL" });
    }

    const path = url.pathname;

    if (path === "/manifest.json" || path === "/manifest")
        return cors(manifest);

    if (path.startsWith("/catalog/movie/recent_movies")) {
        try {
            const movies = await buildMovies();
            return cors({ metas: movies });
        } catch (err) {
            return cors({ metas: [], error: err.message });
        }
    }

    return cors({ status: "ok", alive: true });
}
