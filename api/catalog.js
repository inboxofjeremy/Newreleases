// api/catalog.js
export const config = { runtime: "edge" };

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180;
const REGIONS = ["US"];

// Helper: CORS response
function cors(obj) {
  return new Response(JSON.stringify(obj), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

// Helper: get date n days ago in YYYY-MM-DD
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

// Fetch TMDb pages until exhausted
async function fetchAllTMDBMovies() {
  let page = 1;
  let allMovies = [];

  while (true) {
    const url =
      `https://api.themoviedb.org/3/discover/movie?` +
      `api_key=${TMDB_KEY}&language=en-US&with_original_language=en` +
      `&sort_by=primary_release_date.desc` +
      `&primary_release_date.gte=${DATE_FROM}` +
      `&primary_release_date.lte=${DATE_TO}` +
      `&page=${page}`;

    const res = await fetch(url);
    const json = await res.json();
    if (!json?.results || json.results.length === 0) break;

    allMovies.push(...json.results);

    if (page >= json.total_pages) break;
    page++;
  }

  return allMovies;
}

// Fetch release date in US (any type)
async function fetchUSRelease(id) {
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`,
      { cache: "no-store" }
    );
    const j = await r.json();
    if (!j.results) return null;

    for (const region of REGIONS) {
      const entry = j.results.find(r => r.iso_3166_1 === region);
      if (!entry) continue;
      if (!entry.release_dates || !entry.release_dates.length) continue;

      // Take first available release date in US
      const date = entry.release_dates[0].release_date.split("T")[0];
      return date;
    }
  } catch {
    return null;
  }
  return null;
}

// Build full catalog
async function buildCatalog() {
  const movies = await fetchAllTMDBMovies();

  const metas = await Promise.all(
    movies.map(async m => {
      const releaseInfo = await fetchUSRelease(m.id);
      if (!releaseInfo) return null;

      // Only include releases within last 180 days
      if (releaseInfo < DATE_FROM || releaseInfo > DATE_TO) return null;

      return {
        id: `tmdb:${m.id}`,
        type: "movie",
        name: m.title,
        description: m.overview || "",
        poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
        releaseInfo
      };
    })
  );

  return metas.filter(Boolean);
}

// Edge handler
export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") return cors({ ok: true });

  if (path === "/manifest.json") {
    return cors({
      id: "recent_us_movies",
      version: "1.0.0",
      name: "Recent US Movie Releases",
      description: `All movies released in US theatres, streaming or digital in the last ${DAYS_BACK} days.`,
      types: ["movie"],
      catalogs: [
        { type: "movie", id: "recent_movies", name: "Recent US Movies" }
      ]
    });
  }

  if (path === "/catalog/movie/recent_movies.json") {
    try {
      const metas = await buildCatalog();
      return cors({ metas });
    } catch (err) {
      return cors({ metas: [], error: err.message });
    }
  }

  return cors({ status: "ok" });
}