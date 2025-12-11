// api/index.js
export const config = { runtime: "edge" };

// ===============================
// CONFIG
// ===============================
const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 90;
const REGIONS = ["US", "CA", "GB"];
const HOLLYWOOD_TYPES = [2, 3, 4, 6];

// ==============================
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

function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

// ===============================
// TMDB REGION DATE FETCH
// ===============================
async function fetchRegionalDate(id) {
    try {
        const res = await fetch(
            `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`
        );
        const json = await res.json();
        if (!json.results) return null;

        for (const region of REGIONS) {
            const entry = json.results.find(r => r.iso_3166_1 === region);
            if (!entry) continue;

            const filtered = entry.release_dates
                .filter(r => HOLLYWOOD_TYPES.includes(r.type))
                .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

            if (filtered.length > 0)
                return filtered[0].release_date.split("T")[0];
        }
    } catch { return null; }

    return null;
}

// ===============================
// MAIN MOVIE FETCH
// ===============================
async function fetchMovies() {
    const url =
        `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}` +
        `&language=en-US` +
        `&with_original_language=en` +
        `&sort_by=primary_release_date.desc` +
        `&primary_release_date.gte=${DATE_FROM}` +
        `&primary_release_date.lte=${DATE_TO}`;

    const r = await fetch(url);
    const data = await r.json();
    if (!data.results) return [];

    const results = await Promise.all(
        data.results.map(async m => {
            const release = await fetchRegionalDate(m.id);
            if (!release) return null;
            if (release < DATE_FROM || release > DATE_TO) return null;

            return {
                id: m.id.toString(),
                type: "movie",
                name: m.title,
                poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
                releaseInfo: release,
                description: m.overview || ""
            };
        })
    );

    return results.filter(Boolean);
}

// ===============================
// MANIFEST
// ===============================
const manifest = {
    id: "recent_movies",
    version: "1.0.0",
    name: "Recent Movie Releases",
    description: "Hollywood movies released in the last 90 days",
    catalogs: [
        {
            id: "recent_movies",
            type: "movie",
            name: "Recent Releases",
            extra: [{ name: "skip", isRequired: false }]
        }
    ],
    resources: ["catalog"],
    types: ["movie"]
};

// ===============================
// HANDLER
// ===============================
export default async function handler(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Manifest
    if (path === "/manifest.json")
        return cors(manifest);

    // Catalog — must accept ANY query string
    if (path.startsWith("/catalog/movie/recent_movies")) {
        try {
            const results = await fetchMovies();
            return cors({ metas: results });
        } catch (err) {
            return cors({ metas: [], error: err.message });
        }
    }

    return cors({ status: "ok" });
}
