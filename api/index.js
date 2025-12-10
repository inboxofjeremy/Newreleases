// ===============================
// New Releases Movie Addon (90-day)
// TMDB Hollywood Filter
// Works in Vercel Node.js runtime
// ===============================

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 90;

const REGIONS = ["US", "CA", "GB"];
const HOLLYWOOD_TYPES = [2, 3, 4, 6];

function cors(obj) {
    return new Response(
        typeof obj === "string" ? obj : JSON.stringify(obj),
        {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            },
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

// Manifest
const manifest = {
    id: "recent_movies",
    version: "1.0.0",
    name: "Recent Movie Releases",
    description: "Hollywood movies released in theaters, VOD, streaming in the last 90 days",
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

// Fetch release date
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

            if (filtered.length > 0) {
                return filtered[0].release_date.split("T")[0];
            }
        }
    } catch (err) {
        console.log("release date error", err);
    }

    return null;
}

// MAIN MOVIE FETCH (PARALLEL)
async function fetchMovies() {
    const discoverUrl =
        `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}` +
        `&language=en-US` +
        `&with_original_language=en` +
        `&sort_by=release_date.desc` +
        `&release_date.gte=${DATE_FROM}` +
        `&release_date.lte=${DATE_TO}`;

    const res = await fetch(discoverUrl);
    const data = await res.json();

    if (!data.results) return [];

    // PARALLEL release date requests
    const results = await Promise.all(
        data.results.map(async (m) => {
            const regional = await fetchRegionalDate(m.id);
            if (!regional) return null;
            if (regional < DATE_FROM || regional > DATE_TO) return null;

            return {
                id: m.id.toString(),
                type: "movie",
                name: m.title,
                poster: m.poster_path
                    ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
                    : null,
                releaseInfo: regional,
                description: m.overview || ""
            };
        })
    );

    return results.filter(Boolean);
}

// -------------------------------
// MAIN HANDLER
// -------------------------------
export default async function handler(req) {

    const host = req.headers.host || "localhost";
    const origin = `https://${host}`;
    const url = new URL(req.url, origin);
    const path = url.pathname;

    if (req.method === "OPTIONS")
        return cors({ ok: true });

    if (path === "/manifest" || path === "/manifest.json")
        return cors(manifest);

    if (path.startsWith("/catalog/movie/recent_movies")) {
        try {
            const results = await fetchMovies();
            return cors({ metas: results });
        } catch (err) {
            return cors({ metas: [], error: err.message });
        }
    }

    return cors({ status: "ok", message: "Movie addon online" });
}
