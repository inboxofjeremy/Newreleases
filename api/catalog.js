// No imports needed — fetch is global on Vercel Node 18+

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 90;

const REGIONS = ["US", "CA", "GB"];
const HOLLYWOOD_TYPES = [2, 3, 4, 6];

// ---------- TIMEOUT WRAPPER ----------
function withTimeout(ms, promise) {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), ms)
    );
    return Promise.race([promise, timeout]);
}

function cors(obj) {
    return new Response(
        typeof obj === "string" ? obj : JSON.stringify(obj),
        {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
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

// ---------- SAFE release date lookup with timeout ----------
async function fetchRegionalDate(id) {
    try {
        const res = await withTimeout(
            5000,  // 5 sec max per call
            fetch(`https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`)
        );

        const json = await res.json();
        if (!json.results) return null;

        for (const region of REGIONS) {
            const entry = json.results.find(r => r.iso_3166_1 === region);
            if (!entry) continue;

            const filtered = entry.release_dates
                .filter(r => HOLLYWOOD_TYPES.includes(r.type))
                .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

            if (filtered.length)
                return filtered[0].release_date.split("T")[0];
        }
    } catch (e) {
        return null; // timeout OR error → skip movie
    }

    return null;
}

// ---------- MAIN MOVIE FETCH ----------
async function fetchMovies() {
    const discoverUrl =
        `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}` +
        `&language=en-US` +
        `&region=US` +
        `&sort_by=primary_release_date.desc` +
        `&primary_release_date.gte=${DATE_FROM}` +
        `&primary_release_date.lte=${DATE_TO}`;

    let res, data;

    try {
        res = await withTimeout(8000, fetch(discoverUrl));
        data = await res.json();
    } catch {
        return []; // API down → empty list instead of hang
    }

    if (!data.results) return [];

    // LIMIT to 20 movies to avoid 50 release-date calls
    const top = data.results.slice(0, 20);

    const results = await Promise.all(
        top.map(async (m) => {
            const release = await fetchRegionalDate(m.id);
            if (!release) return null;

            // ensure within date window
            if (release < DATE_FROM || release > DATE_TO) return null;

            return {
                id: m.id.toString(),
                type: "movie",
                name: m.title,
                poster: m.poster_path
                    ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
                    : null,
                releaseInfo: release,
                description: m.overview || ""
            };
        })
    );

    return results.filter(Boolean);
}

// ---------- HANDLER ----------
export default async function handler(req) {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const path = url.pathname;

    if (path === "/catalog/movie/recent_movies.json") {
        try {
            const results = await fetchMovies();
            return cors({ metas: results });
        } catch (err) {
            return cors({ metas: [], error: err.message });
        }
    }

    return cors({ status: "ok" });
}
