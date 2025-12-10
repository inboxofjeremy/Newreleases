// ============================================================================
//  STREMIO – Recent Hollywood Movie Releases (Last 90 Days)
// ============================================================================

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS = 90;

// ============================================================================
//  CORS FOR STREMIO
// ============================================================================
function addCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

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

// Hollywood sanity filter
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
//  FIXED TMDB FETCHER
// ============================================================================
async function fetchRecentMovies() {
  const start = daysAgo(DAYS);
  const end = daysAgo(0);

  // ⭐ Correct producing Hollywood releases
  const url =
    `https://api.themoviedb.org/3/discover/movie` +
    `?api_key=${TMDB_KEY}` +
    `&sort_by=primary_release_date.desc` +
    `&language=en-US` +
    `&with_original_language=en` + // only English films
    `&region=US` + // US release calendar is reliable
    `&primary_release_date.gte=${start}` +
    `&primary_release_date.lte=${end}` +
    `&release_date.gte=${start}` +
    `&release_date.lte=${end}`;

  const json = await fetchJSON(url);

  let movies = json?.results || [];

  // Hollywood filter
  movies = movies.filter(isHollywood);

  // Sort by date
  movies.sort((a, b) => new Date(b.release_date) - new Date(a.release_date));

  return movies;
}

// ============================================================================
//  MANIFEST
// ============================================================================
const manifest = {
  id: "recent-movies-addon",
  version: "1.0.0",
  name: "Recent Hollywood Movies",
  description: "English-language theatrical + streaming movies released in the last 90 days.",
  catalogs: [
    {
      id: "recent_movies",
      type: "movie",
      name: "Recent Movies (Hollywood 90 Days)"
    }
  ],
  resources: ["catalog"],
  types: ["movie"],
  idPrefixes: ["tmdb"]
};

// ============================================================================
//  ROUTER
// ============================================================================
module.exports = async (req, res) => {
  addCORS(res);
  if (req.method === "OPTIONS") return res.end();

  const path = req.url;

  if (path.includes("manifest.json")) {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(manifest));
  }

  if (path.includes("/catalog/movie/recent_movies.json")) {
    const movies = await fetchRecentMovies();
    const metas = movies.map(toMeta);
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ metas }, null, 2));
  }

  // Debug endpoint
  if (path.includes("/api/debug")) {
    const start = daysAgo(DAYS);
    const end = daysAgo(0);
    const url =
      `https://api.themoviedb.org/3/discover/movie` +
      `?api_key=${TMDB_KEY}` +
      `&sort_by=primary_release_date.desc` +
      `&language=en-US` +
      `&with_original_language=en` +
      `&region=US` +
      `&primary_release_date.gte=${start}` +
      `&primary_release_date.lte=${end}` +
      `&release_date.gte=${start}` +
      `&release_date.lte=${end}`;

    const data = await fetchJSON(url);
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ url, data }, null, 2));
  }

  // Default
  res.setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify({ status: "ok", message: "Movie addon online" }));
};
