// api/catalog.js
export const config = { runtime: "edge" };

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180;
const TMDB_CONCURRENCY = 5;

// ==========================
// UTILS
// ==========================
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

function cors(payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
  });
}

async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function pMap(list, fn, concurrency) {
  const out = [];
  let i = 0;
  const workers = Array(concurrency).fill(0).map(async () => {
    while (i < list.length) {
      const idx = i++;
      try {
        out[idx] = await fn(list[idx]);
      } catch {
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out.filter(Boolean);
}

// ==========================
// TMDB DISCOVER → IMDB
// ==========================
async function fetchTMDBMovies() {
  let movies = [];
  for (let page = 1; page <= 10; page++) {
    // discover by primary release date in US
    const url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}` +
      `&region=US&with_original_language=en&sort_by=primary_release_date.desc` +
      `&primary_release_date.gte=${DATE_FROM}&primary_release_date.lte=${DATE_TO}` +
      `&page=${page}`;
    const json = await fetchJSON(url);
    if (!json?.results?.length) break;
    movies.push(...json.results);
    if (page >= json.total_pages) break;
  }
  return movies;
}

async function addIMDbID(movie) {
  if (!movie?.id) return null;
  const ext = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${movie.id}/external_ids?api_key=${TMDB_KEY}`
  );
  return {
    id: `tmdb:${movie.id}`,
    type: "movie",
    name: movie.title,
    description: movie.overview || "",
    poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
    releaseInfo: movie.release_date,
    imdb: ext?.imdb_id || null
  };
}

// ==========================
// MAIN HANDLER
// ==========================
export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/manifest.json") {
    return cors({
      id: "recent_us_movies",
      version: "1.0.0",
      name: "Recent US Releases",
      description: "Movies released in US theaters, digital or streaming in last 180 days",
      catalogs: [
        { type: "movie", id: "recent_movies", name: "Recent Releases" }
      ],
      resources: ["catalog", "meta"],
      types: ["movie"],
      idPrefixes: ["tmdb"]
    });
  }

  if (path === "/catalog/movie/recent_movies.json") {
    try {
      const list = await fetchTMDBMovies();
      const metas = await pMap(list, addIMDbID, TMDB_CONCURRENCY);
      return cors({ metas });
    } catch (err) {
      return cors({ metas: [], error: err.message });
    }
  }

  if (path.startsWith("/meta/movie/")) {
    const id = path.split("/").pop().replace(".json", "");
    const tmdbId = id.replace("tmdb:", "");
    const movie = await fetchJSON(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}`);
    if (!movie) return cors({ meta: { id, type: "movie", name: "Unknown", videos: [] } });

    const ext = await fetchJSON(
      `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${TMDB_KEY}`
    );

    return cors({
      meta: {
        id: `tmdb:${movie.id}`,
        type: "movie",
        name: movie.title,
        description: movie.overview || "",
        poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
        background: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : null,
        imdb: ext?.imdb_id || null,
        videos: []
      }
    });
  }

  return cors({ ok: true });
}