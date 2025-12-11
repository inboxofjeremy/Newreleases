// FAST version – no timeouts

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 90;

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

async function fetchMovies() {
    const url =
        `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}` +
        `&language=en-US` +
        `&region=US` +
        `&with_release_type=2|3|4|6` +
        `&sort_by=primary_release_date.desc` +
        `&primary_release_date.gte=${DATE_FROM}` +
        `&primary_release_date.lte=${DATE_TO}`;

    const res = await fetch(url);
    const json = await res.json();
    if (!json.results) return [];

    return json.results.map(m => ({
        id: `tmdb:${m.id}`,
        type: "movie",
        name: m.title,
        poster: m.poster_path
            ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
            : null,
        description: m.overview || "",
        releaseInfo: m.release_date || null
    }));
}

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
