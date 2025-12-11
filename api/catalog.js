// api/catalog.js
import fetch from "node-fetch";

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";

// 90-day release window
const DAYS_BACK = 90;

// Release types meaning:
// 2 = Theatrical (limited)
// 3 = Theatrical
// 4 = Digital
// 6 = Streaming
const RELEASE_TYPES = "2|3|4|6";

// Regions we query in order of priority
const REGIONS = ["US", "CA", "GB"];

// ---------- Utils ----------
function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
};

// Filter out obvious non-Hollywood junk
function isForeign(item) {
    const lang = item.original_language || "";
    const title = item.title || "";

    // CJK, Cyrillic, Thai, Hindi, Arabic, Korean etc
    const NON_LATIN_REGEX =
        /[\u4E00-\u9FFF\u3040-\u30FF\u31F0-\u31FF\u0400-\u04FF\u0E00-\u0E7F\u0600-\u06FF\u0900-\u097F\uAC00-\uD7AF]/;

    if (NON_LATIN_REGEX.test(title)) return true;

    // Exclude movies from obscure non-English markets
    if (!["en", "fr", "es"].includes(lang)) return true;

    return false;
}

// Convert TMDB data → Stremio metas
function buildMeta(movie, region) {
    return {
        id: movie.id.toString(),
        type: "movie",
        name: movie.title,
        poster: movie.poster_path
            ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
            : null,
        description: movie.overview || "",
        releaseInfo: movie.primary_release_date || null,
        region,
    };
}

// ---------- Fetch movies ----------
async function fetchRegion(region) {
    const url =
        `https://api.themoviedb.org/3/discover/movie` +
        `?api_key=${TMDB_KEY}` +
        `&region=${region}` +
        `&watch_region=${region}` +
        `&with_release_type=${RELEASE_TYPES}` +
        `&sort_by=primary_release_date.desc` +
        `&primary_release_date.gte=${DATE_FROM}` +
        `&primary_release_date.lte=${DATE_TO}` +
        `&language=en-US`;

    const res = await fetch(url);
    const json = await res.json();

    if (!json.results) return [];
    return json.results
        .filter(m => m.primary_release_date)
        .filter(m => !isForeign(m))
        .map(m => buildMeta(m, region));
}

async function fetchAllRegions() {
    let all = [];

    for (const region of REGIONS) {
        const part = await fetchRegion(region);
        all.push(...part);
    }

    // Remove duplicates by movie ID
    const map = new Map();
    for (const m of all) map.set(m.id, m);

    // Final sorted list
    return [...map.values()].sort(
        (a, b) => (b.releaseInfo || "").localeCompare(a.releaseInfo || "")
    );
}

// ---------- Handler ----------
export default async function handler(req, res) {
    try {
        const movies = await fetchAllRegions();
        return res.status(200).json({ metas: movies });
    } catch (err) {
        return res.status(200).json({ metas: [], error: err.message });
    }
}
