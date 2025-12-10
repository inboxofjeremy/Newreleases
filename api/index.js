// api/index.js
export const config = { runtime: "edge" };

// ==========================
// CONFIG
// ==========================
const TMDB_KEY = process.env.TMDB_KEY;

// Accepted release regions
const REGIONS = ["US", "CA", "GB"];

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

// English language detection
function isForeignMovie(m) {
  const lang = (m.original_language || "").toLowerCase();
  if (lang !== "en") return true;
  return false;
}

// Filter short films, adult, or obviously non-standard entries
function isValidMovie(m) {
  if (!m || !m.title) return false;
  if (m.adult) return false;
  return true;
}

// Keep the last 30 days (using local date only)
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
// FETCH MOVIES FROM TMDB
// ==========================
async function fetchTMDBMovies() {
  const { start, end } = getDateRange();

  const url =
    `https://api.themoviedb.org/3/discover/movie` +
    `?api_key=${TMDB_KEY}` +
    `&language=en-US` +
    `&region=US` +
    `&sort_by=release_date.desc` +
    `&release_date.gte=${start}` +
    `&release_date.lte=${end}`;

  const json = await fetchJSON(url);
  if (!json?.results) return [];

  return json.results.filter(isValidMovie).filter((m) => !isForeignMovie(m));
}

// ==========================
// Fetch Region Watch Providers
// ==========================
async function fetchProviders(movieId) {
  const url = `https://api.themoviedb.org/3/movie/${movieId}/watch/providers?api_key=${TMDB_KEY}`;
  const json = await fetchJSON(url);
  if (!json || !json.results) return false;

  // Keep only if movie is available in US, CA, or GB
  return REGIONS.some((r) => json.results[r]);
}

// ==========================
// TMDB → IMDb Fallback
// ==========================
async function tmdbToImdb(movieId) {
  const url = `https://api.themoviedb.org/3/movie/${movieId}/external_ids?api_key=${TMDB_KEY}`;
  const json = await fetchJSON(url);
  return json?.imdb_id || null;
}

// ==========================
// BUILD MOVIES LIST
// ==========================
async function buildMovies() {
  const tmdbMovies = await fetchTMDBMovies();

  const out = [];

  for (const m of tmdbMovies) {
    // Region availability filter
    const okRegion = await fetchProviders(m.id);
    if (!okRegion) continue;

    // IMDb fallback
    const imdb = await tmdbToImdb(m.id);

    // construct clean release date
    const release = m.release_date || null;
    if (!release) continue;

    out.push({
      id: `tmdb:${m.id}`,
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
      imdb: imdb || null,
    });
  }

  // Sort newest → oldest
  out.sort((a, b) => new Date(b.release) - new Date(a.release));

  return out;
}

// ==========================
// HANDLER
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
          name: "Recent Movie Releases",
          description:
            "Movies released in the last 30 days (US/CA/GB). TMDB with IMDb fallback.",
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

  // Meta → Movie Details
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
            videos: [], // no trailers
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
