// api/index.js
export const config = { runtime: "edge" };

// ==========================
// CONFIG
// ==========================
const TMDB_API_KEY = "944017b839d3c040bdd2574083e4c1bc";
const MAX_TMDB_PAGES = 5; // fetch multiple pages for full range
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
  } catch {
    return null;
  }
}

// English-only like TV addon
function isForeignMovie(movie) {
  const lang = (movie.original_language || "").toLowerCase();
  if (lang !== "en") return true;

  const title = movie.title || "";
  if (/[\u4E00-\u9FFF]/.test(title)) return true; // CJK
  if (/[\u0400-\u04FF]/.test(title)) return true; // Cyrillic
  if (/[\u0600-\u06FF]/.test(title)) return true; // Arabic
  if (/[\u0900-\u097F]/.test(title)) return true; // Hindi
  if (/[\u0E00-\u0E7F]/.test(title)) return true; // Thai
  if (/[\uAC00-\uD7AF]/.test(title)) return true; // Hangul

  return false;
}

// Remove adult, shorts, invalid timing
function isValidMovie(movie) {
  if (movie.adult) return false;
  if (isForeignMovie(movie)) return false;
  if ((movie.runtime || 0) < 45) return false;
  return true;
}

// Clean summary text
function cleanHTML(str) {
  return str ? str.replace(/<[^>]+>/g, "").trim() : "";
}

// Date range utility
function getDateStringUTC(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getLast30DaysRange() {
  const today = new Date();
  const todayStr = getDateStringUTC(today);

  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 29);
  const startStr = getDateStringUTC(start);

  return { todayStr, startStr };
}

// Choose the best release date
function pickReleaseDate(movie) {
  if (movie.release_date && movie.release_date !== "0000-00-00")
    return movie.release_date;
  if (movie.first_air_date && movie.first_air_date !== "0000-00-00")
    return movie.first_air_date;
  // fallback to minimal known date? No—ignore invalid movies
  return null;
}

// TMDB → IMDb external data
async function tmdbToImdb(movie) {
  const ext = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${movie.id}/external_ids?api_key=${TMDB_API_KEY}`
  );
  if (!ext?.imdb_id) return null;
  return ext.imdb_id;
}

// ==========================
// TMDB FETCH
// ==========================
async function fetchTMDBMovies(startDate, endDate) {
  const results = [];

  for (let page = 1; page <= MAX_TMDB_PAGES; page++) {
    const url =
      `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}` +
      `&region=US&language=en-US&sort_by=release_date.desc` +
      `&release_date.gte=${startDate}&release_date.lte=${endDate}` +
      `&page=${page}`;

    const json = await fetchJSON(url);
    if (!json?.results?.length) break;

    results.push(...json.results);

    if (page >= json.total_pages) break;
  }

  return results;
}

// ==========================
// MAIN BUILD FUNCTION
// ==========================
async function buildMovies() {
  const { todayStr, startStr } = getLast30DaysRange();

  const tmdbMovies = await fetchTMDBMovies(startStr, todayStr);

  const list = [];

  for (const movie of tmdbMovies) {
    if (!movie.id) continue;
    if (!isValidMovie(movie)) continue;

    const date = pickReleaseDate(movie);
    if (!date) continue;

    // Block future releases
    if (date > todayStr) continue;

    const imdbID = await tmdbToImdb(movie); // fallback metadata link
    const id = imdbID ? `imdb:${imdbID}` : `tmdb:${movie.id}`;

    list.push({
      id,
      type: "movie",
      name: movie.title,
      description: movie.overview || "",
      poster:
        movie.poster_path
          ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
          : null,
      background:
        movie.backdrop_path
          ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
          : null,
      releaseDate: date,
    });
  }

  // newest first
  list.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));

  return list;
}

// ==========================
// META (MOVIE DETAILS)
// ==========================
async function buildMeta(movieId) {
  let tmdbId = null;

  if (movieId.startsWith("tmdb:")) {
    tmdbId = movieId.replace("tmdb:", "");
  } else if (movieId.startsWith("imdb:")) {
    const imdb = movieId.replace("imdb:", "");
    const lookup = await fetchJSON(
      `https://api.themoviedb.org/3/find/${imdb}?api_key=${TMDB_API_KEY}&external_source=imdb_id`
    );
    tmdbId = lookup?.movie_results?.[0]?.id || null;
  }

  if (!tmdbId) return null;

  const movie = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`
  );

  if (!movie) return null;

  return {
    id: movieId,
    type: "movie",
    name: movie.title,
    description: movie.overview || "",
    poster:
      movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
    background:
      movie.backdrop_path
        ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
        : null,
    videos: [], // no trailers as requested
  };
}

// ==========================
// HANDLER
// ==========================
export default async function handler(req) {
  const u = new URL(req.url);
  const p = u.pathname;

  // Manifest
  if (p === "/manifest.json") {
    return new Response(
      JSON.stringify(
        {
          id: "recent_movies",
          version: "1.0.0",
          name: "Recent Movie Releases",
          description: "Movies released in the last 30 days. English only.",
          catalogs: [
            {
              type: "movie",
              id: "recent_movies",
              name: "Recent Movie Releases",
            },
          ],
          resources: ["catalog", "meta"],
          types: ["movie"],
          idPrefixes: ["tmdb", "imdb"],
        },
        null,
        2
      ),
      { headers: CORS }
    );
  }

  // Catalog
  if (p.startsWith("/catalog/movie/recent_movies.json")) {
    const movies = await buildMovies();
    return new Response(JSON.stringify({ metas: movies }, null, 2), {
      headers: CORS,
    });
  }

  // Meta
  if (p.startsWith("/meta/movie/")) {
    const id = p.split("/").pop().replace(".json", "");
    const meta = await buildMeta(id);
    if (!meta) {
      return new Response(
        JSON.stringify({
          meta: { id, type: "movie", name: "Unknown", videos: [] },
        }),
        { headers: CORS }
      );
    }

    return new Response(JSON.stringify({ meta }, null, 2), {
      headers: CORS,
    });
  }

  return new Response("Not found", { status: 404, headers: CORS });
}
