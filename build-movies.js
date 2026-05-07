/**
 * build-movies.js — Stremio static movie catalog (GitHub Pages safe)
 * FIXED: Stremio empty-content issues + proper catalog response shape
 */

import fs from "fs";
import path from "path";

const TMDB_API_KEY = "944017b839d3c040bdd2574083e4c1bc";

const CATALOG_DIR = path.join("./catalog", "movie");

const MAX_PAGES = 5;
const MIN_VOTE_COUNT = 10;

// -----------------------
// HELPERS
// -----------------------
async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("Fetch failed:", res.status, url);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn("Network error:", url);
    return null;
  }
}

function cleanText(s) {
  return s ? s.replace(/<[^>]+>/g, "").trim() : "";
}

// -----------------------
// FETCH MOVIES
// -----------------------
async function fetchMovies() {
  const movies = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `https://api.themoviedb.org/3/discover/movie?` +
      `api_key=${TMDB_API_KEY}` +
      `&language=en-US` +
      `&sort_by=popularity.desc` +
      `&include_adult=false` +
      `&vote_count.gte=${MIN_VOTE_COUNT}` +
      `&page=${page}`;

    const data = await fetchJSON(url);

    if (!data?.results?.length) break;

    movies.push(...data.results);
  }

  return movies;
}

// -----------------------
// DETAILS
// -----------------------
async function getDetails(id) {
  return fetchJSON(
    `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}&language=en-US`
  );
}

// -----------------------
// BUILD
// -----------------------
async function build() {
  console.log("Fetching movies...");

  const rawMovies = await fetchMovies();
  console.log("RAW MOVIES:", rawMovies.length);

  const metas = [];
  const seen = new Set();

  for (const movie of rawMovies) {
    const details = await getDetails(movie.id);
    if (!details) continue;

    const id = details.imdb_id
      ? details.imdb_id
      : `tmdb:${details.id}`;

    if (seen.has(id)) continue;
    seen.add(id);

    metas.push({
      id,
      type: "movie",

      name:
        details.title ||
        details.original_title ||
        "Unknown Title",

      description: cleanText(
        details.overview || "No description available"
      ),

      poster: details.poster_path
        ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
        : "https://via.placeholder.com/500x750?text=No+Poster",

      background: details.backdrop_path
        ? `https://image.tmdb.org/t/p/original${details.backdrop_path}`
        : null,

      released: details.release_date || ""
    });
  }

  // sort newest first
  metas.sort(
    (a, b) =>
      new Date(b.released || 0) - new Date(a.released || 0)
  );

  console.log("FINAL METAS COUNT:", metas.length);

  // -----------------------
  // OUTPUT DIRECTORY
  // -----------------------
  fs.mkdirSync(CATALOG_DIR, { recursive: true });

  const outputPath = path.join(
    CATALOG_DIR,
    "tmdb_new_releases.json"
  );

  // -----------------------
  // CRITICAL STREMIO FIX (CACHE FIELDS)
  // -----------------------
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        metas,
        cacheMaxAge: 3600,
        staleRevalidate: 86400,
        staleError: 86400
      },
      null,
      2
    )
  );

  console.log("Saved to:", outputPath);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
