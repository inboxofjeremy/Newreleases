// ============================================================================
//  STREMIO – Recent Movie Releases (Last 90 Days)
// ============================================================================

// HARD-CODED TMDB KEY
const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";

// Allowed release regions
const REGIONS = ["US", "CA", "GB"];

// 90 days back
const DAYS = 90;

// ============================================================================
//  CORS FIX FOR STREMIO
// ============================================================================
function addCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

// ============================================================================
//  UTILS
// ============================================================================
async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function isHollywood(movie) {
  if (!movie) return false;
  if (movie.original_language !== "en") return false;
  if ((movie.vote_count || 0) < 10) return false;
  return (movie.popularity || 0) >= 3;
}

function toMeta(m) {
  return {
    id: `tmdb:${m.id}`,
    type: "movie",
    name: m.title,
    poster: m.poster_path
      ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
      : null,
    background: m.backdrop_path
      ? `https://image.tmdb.org/t/p/original${m.backdrop_path}`
      : null,
    description: m.overview || "",
    releaseInfo: m.release_date,
  };
}

// ============================================================================
//  TMDB FETCHER
// ============================================================================
async function fetchRecentMovies() {
  const start = daysAgo(DAYS);
  const end = daysAgo(0);

  let found = [];

  for (const region of REGIONS) {
    const url =
      `https://api.themoviedb.org/3/discover/movie` +
      `?api_key=${TMDB_KEY}` +
      `&language=en-US` +
      `&region=${region}` +
      `&sort_by=primary_release_date.desc` +
      `&primary_release_date.gte=${start}` +
      `&primary_release_date.lte=${end}` +
      `&with_release_type=2|3|4|6`; // theatrical, digital, streaming

    const json = await fetchJSON(url);
    if (json?.results?.length) found.push(...json.results);
  }

  // Deduplicate
  const map = new Map();
  for (const m of found) map.set(m.id, m);

  let movies = [...map.values()].filter(isHollywood);

  // Sort newest → oldest
  movies.sort((a, b) => new Date(b.release_date) - new Date(a.release_date));

  return movies;
}

// ============================================================================
//  MANIFEST
// ============================================================================
const manifest = {
  id: "recent-movies-addon",
  version: "1.0.0",
  name: "Recent Movie Releases",
  description: "Movies released in the last 90 days in US/CA/GB.",
  catalogs: [
    { id: "recent_movies", type: "movie", name: "Recent Movies (90 Days)" }
  ],
  resources: ["catalog"],
  types: ["movie"],
  idPrefixes: ["tmdb"]
};

// ============================================================================
//  MAIN HANDLER (ALL ROUTES HERE)
// ============================================================================
module.exports = async (req, res) => {
  addCORS(res);

  if (req.method === "OPTIONS") return res.end();

  const url = req.url;

  // DEBUG ROUTE
  if (url.includes("/api/debug")) {
    const start = daysAgo(DAYS);
    const end = daysAgo(0);

    const testUrl =
      `https://api.themoviedb.org/3/discover/movie` +
      `?api_key=${TMDB_KEY}` +
      `&language=en-US&region=US` +
      `&sort_by=primary_release_date.desc` +
      `&primary_release_date.gte=${start}` +
      `&primary_release_date.lte=${end}` +
      `&with_release_type=2|3|4|6`;

    const data = await fetchJSON(testUrl);

    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ testUrl, data }, null, 2));
  }

  // MANIFEST
  if (url.includes("manifest.json")) {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(manifest, null, 2));
  }

  // CATALOG
  if (url.includes("/catalog/movie/recent_movies.json")) {
    const movies = await fetchRecentMovies();
    const metas = movies.map(toMeta);

    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ metas }, null, 2));
  }

  // DEFAULT
  res.setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify({ status: "ok", message: "Movie addon online" }));
};
