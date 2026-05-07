/**
 * build-movies.js — Stremio static movie catalog
 * IMDb preferred + TMDB fallback
 */

import fs from "fs";
import path from "path";

const TMDB_API_KEY = "944017b839d3c040bdd2574083e4c1bc";

const CATALOG_DIR = path.join("./catalog", "movie");

const DAYS_BACK = 365; // ⬅️ widened for better results
const MAX_PAGES = 10;  // ⬅️ safer + avoids rate limits
const MIN_VOTE_COUNT = 10;

async function fetchJSON(url) {
  try {
    const res = await fetch(url);

    if (!res.ok) {
      console.warn("TMDB error:", res.status, url);
      return null;
    }

    return await res.json();
  } catch (e) {
    console.warn("Fetch failed:", url);
    return null;
  }
}

function cleanHTML(s) {
  return s ? s.replace(/<[^>]+>/g, "").trim() : "";
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const DATE_FROM = daysAgo(DAYS_BACK);

// =======================
// FILTERS (SIMPLIFIED)
// =======================

function isBlockedLanguage(movie) {
  const blocked = new Set([
    "it", "tr", "id", "th", "ar", "no"
    // ⬅️ removed fr/es/de/ko/zh/hi (too aggressive)
  ]);

  return blocked.has(String(movie.original_language || "").toLowerCase());
}

function isDocumentary(movie) {
  return movie.genre_ids?.includes(99);
}

// =======================
// FETCH MOVIES
// =======================
async function fetchMovies() {
  const movies = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `https://api.themoviedb.org/3/discover/movie?` +
      `api_key=${TMDB_API_KEY}` +
      `&language=en-US` +
      `&region=US` +
      `&sort_by=popularity.desc` + // ⬅️ MUCH better than release date
      `&include_adult=false` +
      `&vote_count.gte=${MIN_VOTE_COUNT}` +
      `&primary_release_date.gte=${DATE_FROM}` +
      `&with_original_language=en` + // ⬅️ cleaner filtering at API level
      `&page=${page}`;

    const data = await fetchJSON(url);

    if (!data || !Array.isArray(data.results)) break;

    for (const movie of data.results) {
      if (!movie?.id) continue;

      if (isDocumentary(movie) || isBlockedLanguage(movie)) continue;

      movies.push(movie);
    }

    if (page >= (data.total_pages || 0)) break;
  }

  return movies;
}

// =======================
// DETAILS
// =======================
async function tmdbMovieDetails(id) {
  return await fetchJSON(
    `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}&language=en-US`
  );
}

// =======================
// BUILD
// =======================
async function build() {
  console.log("Fetching movies...");

  const rawMovies = await fetchMovies();

  const metas = [];
  const seen = new Set();

  for (const movie of rawMovies) {
    const details = await tmdbMovieDetails(movie.id);
    if (!details) continue;

    const id =
      details.imdb_id ? details.imdb_id : `tmdb:${details.id}`;

    if (seen.has(id)) continue;
    seen.add(id);

    metas.push({
      id,
      type: "movie",
      name: details.title || details.original_title,
      description: cleanHTML(details.overview),
      poster: details.poster_path
        ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
        : null,
      background: details.backdrop_path
        ? `https://image.tmdb.org/t/p/original${details.backdrop_path}`
        : null,
      released: details.release_date || null,
      imdb: details.imdb_id || null
    });
  }

  metas.sort((a, b) =>
    new Date(b.released || 0) - new Date(a.released || 0)
  );

  fs.mkdirSync(CATALOG_DIR, { recursive: true });

  fs.writeFileSync(
    path.join(CATALOG_DIR, "tmdb_new_releases.json"),
    JSON.stringify({ metas }, null, 2)
  );

  console.log("Build complete:", metas.length, "movies");
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
