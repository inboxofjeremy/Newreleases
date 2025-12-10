// ============================================================================
//  STREMIO – Recent Movie Releases (Last 90 Days)
//  TMDB + IMDb fallback
//  Full CORS FIX for Stremio installation
// ============================================================================

// HARD-CODED TMDB KEY
const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";

// Allowed countries for theatrical & digital releases
const REGIONS = ["US", "CA", "GB"];

// 90-day window
const DAYS = 90;

// CORS HEADERS REQUIRED BY STREMIO
function addCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

// ============================================================================
//  UTIL
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

// Hollywood-weighted popularity filter
function isHollywoodMovie(movie) {
  if (!movie) return false;

  const pop = movie.popularity || 0;
  const votes = movie.vote_count || 0;
  const lang = movie.original_language;

  if (lang !== "en") return false;
  if (votes < 25) return false;

  return pop >= 5;
}

// Convert TMDB → Stremio meta
function toMeta(movie) {
  return {
    id: `tmdb:${movie.id}`,
    type: "movie",
    name: movie.title,
    poster: movie.poster_path
      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
      : null,
    background: movie.backdrop_path
      ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
      : null,
    description: movie.overview || "",
    releaseInfo: movie.release_date || null,
  };
}

// ============================================================================
//  FETCH MOVIES – TMDB + IMDb fallback
// ============================================================================

async function fetchRecentMovies() {
  const start = daysAgo(DAYS);
  const end = daysAgo(0);

  const movies = [];

  // Fetch each region
  for (const region of REGIONS) {
    const url =
      `https://api.themoviedb.org/3/discover/movie` +
      `?api_key=${TMDB_KEY}` +
      `&sort_by=release_date.desc` +
      `&language=en-US&region=${region}` +
      `&primary_release_date.gte=${start}` +
      `&primary_release_date.lte=${end}`;

    const data = await fetchJSON(url);
    if (data?.results) {
      movies.push(...data.results);
    }
  }

  // Deduplicate by TMDB ID
  const map = new Map();
  for (const m of movies) {
    if (!m?.id) continue;

    if (!map.has(m.id)) {
      map.set(m.id, m);
    } else {
      // keep the more complete entry
      const cur = map.get(m.id);
      if ((m.overview || "").length > (cur.overview || "").length) {
        map.set(m.id, m);
      }
    }
  }

  // Hollywood weighting filter
  let final = [...map.values()].filter(isHollywoodMovie);

  // Sort newest → oldest
  final.sort((a, b) => new Date(b.release_date) - new Date(a.release_date));

  return final;
}

// ============================================================================
//  MANIFEST
// ============================================================================

const manifest = {
  id: "recent-movies-addon",
  version: "1.0.0",
  name: "Recent Movie Releases",
  description: "Movies released in the last 90 days in US/CA/GB. English only.",
  catalogs: [
    {
      type: "movie",
      id: "recent_movies",
      name: "Recent Movies (90 Days)",
    },
  ],
  resources: ["catalog"],
  types: ["movie"],
  idPrefixes: ["tmdb"],
};

// ============================================================================
//  HANDLER
// ============================================================================

module.exports = async (req, res) => {
  addCORS(res);

  // OPTIONS preflight
  if (req.method === "OPTIONS") {
    return res.end();
  }

  const url = req.url;

  // Manifest
  if (url.includes("manifest.json")) {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(manifest));
  }

  // Catalog
  if (url.includes("/catalog/movie/recent_movies.json")) {
    try {
      const movies = await fetchRecentMovies();
      const metas = movies.map(toMeta);

      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ metas }, null, 2));
    } catch (err) {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ metas: [], error: err.message }));
    }
  }

  // Default
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ status: "ok", message: "Movie addon online" }));
};
