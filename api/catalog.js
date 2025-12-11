// api/catalog.js
export const config = { runtime: "edge" };

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180;
const REGIONS = ["US"];
const MOVIES_PER_PAGE = 20; // TMDb default per page

// CORS helper
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

// Helper: get date n days ago
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

// Fetch a single TMDb page
async function fetchTMDBPage(page = 1) {
  const url =
    `https://api.themoviedb.org/3/discover/movie?` +
    `api_key=${TMDB_KEY}&language=en-US&with_original_language=en` +
    `&sort_by=primary_release_date.desc` +
    `&primary_release_date.gte=${DATE_FROM}` +
    `&primary_release_date.lte=${DATE_TO}` +
    `&page=${page}`;

  const res = await fetch(url);
  const json = await res.json();
  return json;
}

// Fetch US release date for a movie
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
      if (!entry || !entry.release_dates.length) continue;

      return entry.release_dates[0].release_date.split("T")[0];
    }
  } catch {
    return null;
  }
  return null;
}

// Build a single catalog page
async function buildPage(page = 1) {
  const data = await fetchTMDBPage(page);
  if (!data?.results?.length) return [];

  const metas = await Promise.all(
    data.results.map(async m => {
      const releaseInfo = await fetchUSRelease(m.id);
      if (!releaseInfo) return null;
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

// Handler
export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname;
  const searchParams = url.searchParams;

  if (req.method === "OPTIONS") return cors({ ok: true });

  if (path === "/manifest.json") {
    return cors({
      id: "recent_us_movies",
      version: "1.0.0",
      name: "Recent US Movie Releases",
      description: `All movies released in US theatres, streaming or digital in the last ${DAYS_BACK} days.`,
      types: ["movie"],
      catalogs: [
        {
          type: "movie",
          id: "recent_movies",
          name: "Recent US Movies",
          extra: [
            { name: "page", isRequired: false }
          ]
        }
      ]
    });
  }

  if (path === "/catalog/movie/recent_movies.json") {
    try {
      const page = parseInt(searchParams.get("page")) || 1;
      const metas = await buildPage(page);
      return cors({ metas });
    } catch (err) {
      return cors({ metas: [], error: err.message });
    }
  }

  return cors({ status: "ok" });
}