// ===== CONFIG =====

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";

// Hollywood-weighted multiregion
const REGIONS = ["US", "CA", "GB"];
const LANG = "en-US";

// Look back 90 days
const DAYS_BACK = 90;

// ===== HTTP WRAPPER =====

async function http(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("TMDB request failed");
  return res.json();
}

// ===== DATE LOGIC =====

function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

const MAX_DATE = today();
const MIN_DATE = daysAgo(DAYS_BACK);

// ===== TMDB FETCH =====

async function fetchRecentMovies() {
  let movies = [];

  for (const region of REGIONS) {
    const url =
      `https://api.themoviedb.org/3/discover/movie?` +
      `api_key=${TMDB_KEY}` +
      `&language=${LANG}` +
      `&region=${region}` +
      `&sort_by=release_date.desc` +
      `&primary_release_date.gte=${MIN_DATE}` +
      `&primary_release_date.lte=${MAX_DATE}` +
      `&with_original_language=en` +
      `&vote_count.gte=50` +
      `&with_release_type=2|3|4|6`; // Hollywood-weighted types

    try {
      const data = await http(url);
      if (data && data.results) {
        movies = movies.concat(data.results);
      }
    } catch (e) {
      console.log("TMDB region fetch failed", region, e.message);
    }
  }

  // Remove duplicates by TMDB id
  const seen = new Set();
  movies = movies.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  return movies;
}

// ===== STREMIO META BUILDER =====

function convertToStremioMeta(movie) {
  return {
    id: "tmdb:" + movie.id,
    type: "movie",
    name: movie.title,
    poster: movie.poster_path
      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
      : null,
    background: movie.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}`
      : null,
    description: movie.overview || "",
    releaseInfo: movie.release_date || "",
    year: movie.release_date ? Number(movie.release_date.slice(0, 4)) : null
  };
}

// ===== MANIFEST =====

const manifest = {
  id: "recent_movies",
  version: "1.0.0",
  name: "Recent Movie Releases",
  description: "Movies released in the last 90 days (US/CA/GB, English only)",
  types: ["movie"],
  catalogs: [
    {
      type: "movie",
      id: "recent_movies",
      name: "Recent Movies"
    }
  ]
};

// ===== MAIN ROUTER =====

module.exports = async (req, res) => {
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
      const metas = movies.map(convertToStremioMeta);

      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ metas }));
    } catch (e) {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ metas: [], error: e.message }));
    }
  }

  // Default fallback
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ status: "ok", message: "Stremio TMDB Movie Addon" }));
};
