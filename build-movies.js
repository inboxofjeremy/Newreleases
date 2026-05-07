/**
 * build-movies.js — Stremio static movie catalog
 * IMDb IDs preferred + TMDB fallback
 * GitHub Pages ONLY
 */

import fs from "fs";
import path from "path";

// =======================
// CONFIG
// =======================
const TMDB_API_KEY = "944017b839d3c040bdd2574083e4c1bc";

const OUT_DIR = "./";
const CATALOG_DIR = path.join(OUT_DIR, "catalog", "movie");

const DAYS_BACK = 180;
const MAX_PAGES = 20;
const MIN_VOTE_COUNT = 5;

// =======================
// HELPERS
// =======================
async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
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
const DATE_TO = daysAgo(0);

// =======================
// CONTENT FILTERS
// =======================
function isForeign(movie) {
  const allowed = ["en"];

  const lang = String(
    movie.original_language || ""
  ).toLowerCase();

  return !allowed.includes(lang);
}

function isDocumentary(movie) {
  return (movie.genre_ids || []).includes(99);
}

function isHorror(movie) {
  return (movie.genre_ids || []).includes(27);
}

function isBlockedLanguage(movie) {
  const blocked = [
    "it",
    "tr",
    "id",
    "es",
    "th",
    "ar",
    "no",
    "de",
    "zh",
    "ko",
    "fr",
    "hi"
  ];

  return blocked.includes(
    String(movie.original_language || "").toLowerCase()
  );
}

// =======================
// TMDB HELPERS
// =======================
async function tmdbMovieDetails(id) {
  return await fetchJSON(
    `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}&language=en-US`
  );
}

async function tmdbFindByImdb(imdb) {
  const url =
    `https://api.themoviedb.org/3/find/${imdb}` +
    `?api_key=${TMDB_API_KEY}` +
    `&external_source=imdb_id`;

  const data = await fetchJSON(url);

  return data?.movie_results?.[0] || null;
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
      `&sort_by=primary_release_date.desc` +
      `&vote_count.gte=${MIN_VOTE_COUNT}` +
      `&primary_release_date.gte=${DATE_FROM}` +
      `&primary_release_date.lte=${DATE_TO}` +
      `&without_genres=27` + // horror
      `&page=${page}`;

    const data = await fetchJSON(url);

    if (!data?.results?.length) break;

    for (const movie of data.results) {
      if (!movie?.id) continue;

      if (
        isForeign(movie) ||
        isBlockedLanguage(movie) ||
        isDocumentary(movie) ||
        isHorror(movie)
      ) {
        continue;
      }

      movies.push(movie);
    }

    if (page >= data.total_pages) break;
  }

  return movies;
}

// =======================
// MAIN BUILD
// =======================
async function build() {
  console.log("Fetching movies...");

  const rawMovies = await fetchMovies();

  const metas = [];
  const seen = new Set();

  for (const movie of rawMovies) {
    const details = await tmdbMovieDetails(movie.id);

    if (!details) continue;

    let stremioId = null;

    // Prefer IMDb ID
    if (details.imdb_id) {
      stremioId = details.imdb_id;
    } else {
      stremioId = `tmdb:${details.id}`;
    }

    if (!stremioId) continue;
    if (seen.has(stremioId)) continue;

    seen.add(stremioId);

    metas.push({
      id: stremioId,
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

  // =======================
  // OUTPUT
  // =======================
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
