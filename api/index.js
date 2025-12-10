// api/index.js
export const config = { runtime: "edge" };

// ==========================
// CONFIG
// ==========================
const TMDB_KEY = process.env.TMDB_KEY;

const PRIORITY_REGIONS = ["US", "CA", "GB"];
const POPULAR_PAGES = 20; // Option C
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json",
};

// ==========================
// UTILS
// ==========================
async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

function cleanHTML(str) {
  return str ? str.replace(/<[^>]+>/g, "").trim() : "";
}

function isForeign(m) {
  return (m.original_language || "").toLowerCase() !== "en";
}

function isValidMovie(m) {
  if (!m) return false;
  if (!m.title) return false;
  if (m.adult) return false;
  return true;
}

function getDateRange() {
  const today = new Date();
  const start = new Date();
  start.setDate(today.getDate() - 30);

  return {
    start: start.toISOString().slice(0, 10),
    end: today.toISOString().slice(0, 10),
  };
}

// ==========================
// GET REAL PRIORITY REGION RELEASE DATE
// ==========================
async function getRegionRelease(movieId) {
  const url = `https://api.themoviedb.org/3/movie/${movieId}/release_dates?api_key=${TMDB_KEY}`;
  const json = await fetchJSON(url);
  if (!json?.results) return null;

  for (const region of PRIORITY_REGIONS) {
    const entry = json.results.find((x) => x.iso_3166_1 === region);
    if (!entry || !entry.release_dates) continue;

    // Release types: theatrical, digital, streaming, etc.
    const rd = entry.release_dates.find((r) =>
      [1, 2, 3, 4, 6].includes(r.type)
    );

    if (rd?.release_date) {
      return rd.release_date.slice(0, 10);
    }
  }
  return null;
}

// ==========================
// TMDB → IMDb
// ==========================
async function tmdbToImdb(id) {
  const url = `https://api.themoviedb.org/3/movie/${id}/external_ids?api_key=${TMDB_KEY}`;
  const json = await fetchJSON(url);
  return json?.imdb_id || null;
}

// ==========================
// FETCH POPULAR MOVIES
// ==========================
async function fetchPopularMovies() {
  const list = [];

  for (let p = 1; p <= POPULAR_PAGES; p++) {
    const url =
      `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_KEY}` +
      `&language=en-US&page=${p}`;

    const json = await fetchJSON(url);
    if (!json?.results) break;

    for (const m of json.results) {
      if (isValidMovie(m) && !isForeign(m)) {
        list.push(m);
      }
    }
  }

  return list;
}

// ==========================
// MAIN BUILDER
// ==========================
async function buildMovies() {
  const popular = await fetchPopularMovies();
  const { start, end } = getDateRange();
  const out = [];

  for (const m of popular) {
    const movieId = m.id;

    // Extract real US/CA/GB release date
    const release = await getRegionRelease(movieId);
    if (!release) continue;

    // Ensure inside last 30 days
    if (release < start || release > end) continue;

    const imdb = await tmdbToImdb(movieId);

    out.push({
      id: `tmdb:${movieId}`,
      type: "movie",
      name: m.title,
      description: cleanHTML(m.overview),
      poster: m.poster_path
        ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
        : null,
      background: m.backdrop_path
        ? `https://image.tmdb.org/t/p/original${m.backdrop_path}`
        : null,
      release: release,
      imdb: imdb,
    });
  }

  // Sort newest → oldest
  out.sort((a, b) => new Date(b.release) - new Date(a.release));

  return out;
}

// ==========================
// ROUTER
// ==========================
export default async function handler(req) {
  const url = new URL(req.url);
  const p = url.pathname;

  // Manifest
  if (p === "/manifest.json") {
    return new Response(
      JSON.stringify(
        {
          id: "recent_movies",
          version: "1.0.0",
          name: "Hollywood Recent Movie Releases",
          description:
            "Hollywood theatrical/digital/streaming releases from the last 30 days (US/CA/GB). Uses TMDB + IMDb fallback.",
          catalogs: [
            {
              type: "movie",
              id: "recent_movies",
              name: "Recent Movies",
            },
          ],
          resources: ["catalog", "meta"],
          types: ["movie"],
          idPrefixes: ["tmdb"],
        },
        null,
        2
      ),
      { headers: CORS }
    );
  }

  // Catalog
  if (p.startsWith("/catalog/movie/recent_movies")) {
    const movies = await buildMovies();
    return new Response(JSON.stringify({ metas: movies }, null, 2), {
      headers: CORS,
    });
  }

  // Meta
  if (p.startsWith("/meta/movie/")) {
    const id = p.split("/").pop().replace(".json", "");
    const tmdbId = id.replace("tmdb:", "");

    const m = await fetchJSON(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`
    );

    if (!m) {
      return new Response(
        JSON.stringify({
          meta: { id, type: "movie", name: "Unknown", videos: [] },
        }),
        { headers: CORS }
      );
    }

    return new Response(
      JSON.stringify(
        {
          meta: {
            id,
            type: "movie",
            name: m.title,
            description: cleanHTML(m.overview),
            poster: m.poster_path
              ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
              : null,
            background: m.backdrop_path
              ? `https://image.tmdb.org/t/p/original${m.backdrop_path}`
              : null,
            videos: [],
          },
        },
        null,
        2
      ),
      { headers: CORS }
    );
  }

  return new Response("Not found", { status: 404, headers: CORS });
}
