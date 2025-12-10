// api/index.js
export const config = { runtime: "edge" };

// ==========================
// CONFIG
// ==========================
const TMDB_API_KEY = "944017b839d3c040bdd2574083e4c1bc";
const MAX_TMDB_PAGES = 5;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json"
};

// ==========================
// UTILS
// ==========================
async function fetchJSON(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Clean summary
function cleanHTML(str) {
  return str ? str.replace(/<[^>]+>/g, "").trim() : "";
}

// Date helpers
function dateToStr(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function last30Days() {
  const today = new Date();
  const todayStr = dateToStr(today);

  const earlier = new Date();
  earlier.setUTCDate(earlier.getUTCDate() - 29);
  const startStr = dateToStr(earlier);

  return { startStr, todayStr };
}

// English filter — clean & reliable
function isForeignMovie(movie) {
  return movie.original_language !== "en";
}

// Pick release date
function pickReleaseDate(movie) {
  if (movie.release_date && movie.release_date !== "0000-00-00")
    return movie.release_date;

  if (movie.first_air_date && movie.first_air_date !== "0000-00-00")
    return movie.first_air_date;

  return null;
}

// TMDB → IMDb external ID lookup
async function tmdbToImdb(movie) {
  const ext = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${movie.id}/external_ids?api_key=${TMDB_API_KEY}`
  );
  return ext?.imdb_id || null;
}

// ==========================
// TMDB FETCH
// ==========================
async function fetchTMDBMovies(start, end) {
  const results = [];

  for (let page = 1; page <= MAX_TMDB_PAGES; page++) {
    const url =
      `https://api.themoviedb.org/3/discover/movie` +
      `?api_key=${TMDB_API_KEY}` +
      `&language=en-US&region=US` +
      `&sort_by=primary_release_date.desc` +
      `&primary_release_date.gte=${start}` +
      `&primary_release_date.lte=${end}` +
      `&include_adult=false` +
      `&page=${page}`;

    const json = await fetchJSON(url);
    if (!json?.results?.length) break;

    results.push(...json.results);
    if (page >= json.total_pages) break;
  }

  return results;
}

// ==========================
// BUILD MOVIES LIST
// ==========================
async function buildMovies() {
  const { startStr, todayStr } = last30Days();

  const tmdbMovies = await fetchTMDBMovies(startStr, todayStr);

  const list = [];

  for (const movie of tmdbMovies) {
    if (!movie.id) continue;
    if (movie.adult) continue;

    if (isForeignMovie(movie)) continue;

    const date = pickReleaseDate(movie);
    if (!date) continue;

    // Never include future releases
    if (date > todayStr) continue;

    const imdbID = await tmdbToImdb(movie);
    const id = imdbID ? `imdb:${imdbID}` : `tmdb:${movie.id}`;

    list.push({
      id,
      type: "movie",
      name: movie.title,
      description: movie.overview || "",
      poster: movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
      background: movie.backdrop_path
        ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
        : null,
      releaseDate: date
    });
  }

  // Sort newest → oldest
  list.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));

  return list;
}

// ==========================
// META (DETAILS)
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
    poster: movie.poster_path
      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
      : null,
    background: movie.backdrop_path
      ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
      : null,
    videos: [] // No trailers per your request
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
              name: "Recent Movie Releases"
            }
          ],
          resources: ["catalog", "meta"],
          types: ["movie"],
          idPrefixes: ["tmdb", "imdb"]
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
      headers: CORS
    });
  }

  // Meta
  if (p.startsWith("/meta/movie/")) {
    const id = p.split("/").pop().replace(".json", "");
    const meta = await buildMeta(id);

    if (!meta) {
      return new Response(
        JSON.stringify({
          meta: { id, type: "movie", name: "Unknown", videos: [] }
        }),
        { headers: CORS }
      );
    }

    return new Response(JSON.stringify({ meta }, null, 2), {
      headers: CORS
    });
  }

  return new Response("Not found", { status: 404, headers: CORS });
}
