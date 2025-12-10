// ===============================
// New Releases Movie Addon (90-day)
// Combined TMDB Hollywood addon
// Fully CORS-safe for Stremio
// ===============================

// ---- CONFIG ----
const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 90;

const REGIONS = ["US", "CA", "GB"];
const HOLLYWOOD_TYPES = [2, 3, 4, 6]; 
// 2 – Scripted, 3 – Documentary, 4 – Animation, 6 – Reality
// TMDB "genres" doesn't do Hollywood; release_types does

// ----- CORS WRAPPER -----
function cors(responseObj) {
    return new Response(
        typeof responseObj === "string"
            ? responseObj
            : JSON.stringify(responseObj),
        {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                "Access-Control-Allow-Headers": "*"
            }
        }
    );
}

// ----- DATE HELPERS -----
function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

// ---- MANIFEST ----
const manifest = {
    id: "recent_movies",
    version: "1.0.0",
    name: "Recent Movie Releases",
    description: "Hollywood movies released in theaters, VOD, or streaming in last 90 days",
    types: ["movie"],
    catalogs: [
        {
            id: "recent_movies",
            type: "movie",
            name: "Recent Releases",
            extra: []
        }
    ]
};

// ---- FETCH REGIONAL RELEASE DATE ----
async function fetchRegionalDate(movieId) {
    try {
        const url = `https://api.themoviedb.org/3/movie/${movieId}/release_dates?api_key=${TMDB_KEY}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!json.results) return null;

        for (const region of REGIONS) {
            const entry = json.results.find(r => r.iso_3166_1 === region);
            if (!entry || !entry.release_dates) continue;

            const dates = entry.release_dates
                .filter(d => HOLLYWOOD_TYPES.includes(d.type))
                .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

            if (dates.length > 0) {
                return dates[0].release_date.split("T")[0];
            }
        }
    } catch (e) {
        console.log("region date error", e);
    }
    return null;
}

// ---- FETCH MOVIES ----
async function fetchMovies() {
    const url =
        `https://api.themoviedb.org/3/discover/movie?` +
        `api_key=${TMDB_KEY}` +
        `&language=en-US` +
        `&sort_by=release_date.desc` +
        `&with_original_language=en` +
        `&release_date.gte=${DATE_FROM}` +
        `&release_date.lte=${DATE_TO}`;

    const res = await fetch(url);
    const data = await res.json();

    if (!data.results) return [];

    const movies = [];

    for (const m of data.results) {
        const regionalDate = await fetchRegionalDate(m.id);

        if (!regionalDate) continue;
        if (regionalDate < DATE_FROM || regionalDate > DATE_TO) continue;

        movies.push({
            id: m.id.toString(),
            name: m.title,
            poster: m.poster_path
                ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
                : null,
            description: m.overview || "",
            type: "movie",
            releaseInfo: regionalDate
        });
    }

    return movies;
}

// ---- ROUTER ----
export default async function handler(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") return cors({ ok: true });

    // Manifest
    if (path === "/manifest.json" || path === "/manifest") {
        return cors(manifest);
    }

    // Catalog
    if (path.startsWith("/catalog/movie/recent_movies")) {
        try {
            const movies = await fetchMovies();
            return cors({ metas: movies });
        } catch (e) {
            return cors({ metas: [], error: e.message });
        }
    }

    // Catch-all
    return cors({ status: "ok", message: "Movie addon online" });
}
