// /api/catalog.js
export const config = { runtime: "edge" };

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 180;
const MAX_PAGES = 10;        // same as before
const TMDB_CONCURRENCY = 5;  // moderate concurrency for release checks
const MIN_VOTE_COUNT = 20;   // exclude extremely low-profile items

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

function cors(obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
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

async function fetchUSReleaseDate(id) {
  try {
    const json = await fetchJSON(`https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`);
    if (!json?.results) return null;
    const us = json.results.find(r => r.iso_3166_1 === "US");
    if (!us?.release_dates?.length) return null;
    // return earliest US date
    return us.release_dates.map(d => d.release_date?.slice(0,10)).filter(Boolean).sort()[0] || null;
  } catch {
    return null;
  }
}

// concurrency-limited mapper
async function pMap(list, fn, concurrency = 5) {
  const out = new Array(list.length);
  let i = 0;
  const workers = Array(concurrency).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= list.length) break;
      try { out[idx] = await fn(list[idx], idx); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchMovies() {
  const all = [];

  // Discover: filter by origin country US, english original language, vote_count threshold
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `https://api.themoviedb.org/3/discover/movie?` +
      `api_key=${TMDB_KEY}` +
      `&language=en-US` +
      `&with_original_language=en` +
      `&with_origin_country=US` +               // only US productions
      `&vote_count.gte=${MIN_VOTE_COUNT}` +     // filter out very tiny releases
      `&sort_by=primary_release_date.desc` +
      `&primary_release_date.gte=${DATE_FROM}` +
      `&primary_release_date.lte=${DATE_TO}` +
      `&page=${page}`;

    const j = await fetchJSON(url);
    if (!j?.results?.length) break;

    all.push(...j.results);
    if (page >= j.total_pages) break;
  }

  // For each candidate, confirm there's a US release date in window
  const mapped = await pMap(all, async (m) => {
    if (!m?.id) return null;

    // quick guard: drop items with extremely short runtime if present (optional)
    // if (m.runtime && m.runtime < 20) return null; // can't rely on runtime here

    const usDate = await fetchUSReleaseDate(m.id);
    if (!usDate) return null;
    if (usDate < DATE_FROM || usDate > DATE_TO) return null;

    return {
      id: `tmdb:${m.id}`,
      type: "movie",
      name: m.title || m.original_title || `Movie ${m.id}`,
      description: m.overview || "",
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      releaseInfo: usDate
    };
  }, TMDB_CONCURRENCY);

  return mapped.filter(Boolean);
}

export default async function handler(req) {
  const u = new URL(req.url);
  const p = u.pathname;

  if (req.method === "OPTIONS") return cors({ ok: true });

  if (p === "/manifest.json") {
    return cors({
      id: "recent_us_movies",
      version: "1.0.0",
      name: "Recent US Movie Releases",
      description: `US movies released in last ${DAYS_BACK} days`,
      resources: ["catalog","meta"],
      types: ["movie"],
      catalogs: [{ id: "recent_movies", type: "movie", name: "Recent Movies" }],
      idPrefixes: ["tmdb"]
    });
  }

  if (p === "/catalog/movie/recent_movies.json") {
    try {
      const metas = await fetchMovies();
      return cors({ metas });
    } catch (err) {
      return cors({ metas: [], error: err?.message || String(err) });
    }
  }

  if (p.startsWith("/meta/movie/")) {
    const id = p.split("/").pop().replace(".json", "");
    const tmdbId = id.startsWith("tmdb:") ? id.split(":")[1] : id;
    if (!tmdbId) return cors({ meta: null });

    const movie = await fetchJSON(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`);
    if (!movie) return cors({ meta: null });

    return cors({
      meta: {
        id: `tmdb:${movie.id}`,
        type: "movie",
        name: movie.title,
        description: movie.overview || "",
        poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
        background: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : null,
        released: movie.release_date || null,
        imdb: movie.imdb_id || null
      }
    });
  }

  return cors({ ok: true });
}