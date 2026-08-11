import fs from "fs";
import path from "path";

// ===============================
// CONFIG
// ===============================
const TMDB_KEY = process.env.TMDB_API_KEY;

if (!TMDB_KEY) {
  console.error("ERROR: TMDB_API_KEY environment variable is not set.");
  process.exit(1);
}

const DAYS_BACK = 180;
const CHUNK_SIZE_DAYS = 7;
const MAX_PAGES_PER_CHUNK = 20;
const TMDB_CONCURRENCY = 8;
const MIN_VOTE_COUNT = 0;

// ===============================
// DATE HELPERS (Fine-grained 7-day chunks)
// ===============================
function getDateChunks(totalDaysBack = DAYS_BACK, chunkSizeDays = CHUNK_SIZE_DAYS) {
  const chunks = [];
  let currentEnd = new Date();
  currentEnd.setDate(currentEnd.getDate() + 2);

  const finalStart = new Date();
  finalStart.setDate(finalStart.getDate() - totalDaysBack);

  while (currentEnd > finalStart) {
    let currentStart = new Date(currentEnd);
    currentStart.setDate(currentStart.getDate() - chunkSizeDays);

    if (currentStart < finalStart) {
      currentStart = new Date(finalStart);
    }

    chunks.push({
      from: currentStart.toISOString().slice(0, 10),
      to: currentEnd.toISOString().slice(0, 10),
    });

    currentEnd = new Date(currentStart);
  }

  return chunks;
}

// ===============================
// FETCH HELPERS
// ===============================
async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// ===============================
// ALLOW +2 DAY WINDOW
// ===============================
function isAllowed(dateStr) {
  if (!dateStr) return false;

  const date = new Date(dateStr).getTime();
  const now = Date.now();

  const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
  const minTime = now - DAYS_BACK * 24 * 60 * 60 * 1000;

  return date >= minTime && date <= (now + TWO_DAYS);
}

// ===============================
// RELEASE DATE HELPER
// ===============================
async function getEffectiveReleaseDate(movieObj) {
  const json = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${movieObj.id}/release_dates?api_key=${TMDB_KEY}`
  );

  if (json?.results) {
    const us = json.results.find((r) => r.iso_3166_1 === "US");
    if (us?.release_dates?.length) {
      const allUsDates = us.release_dates
        .filter((d) => d.release_date)
        .map((d) => d.release_date.slice(0, 10))
        .sort();

      if (allUsDates.length) {
        return allUsDates[0];
      }
    }
  }

  if (movieObj.release_date) {
    return movieObj.release_date.slice(0, 10);
  }

  return null;
}

// ===============================
// CONCURRENCY
// ===============================
async function pMap(list, fn, concurrency = TMDB_CONCURRENCY) {
  const out = new Array(list.length);
  let i = 0;

  const workers = Array(concurrency)
    .fill(0)
    .map(async () => {
      while (true) {
        const idx = i++;
        if (idx >= list.length) break;
        try {
          out[idx] = await fn(list[idx], idx);
        } catch {
          out[idx] = null;
        }
      }
    });

  await Promise.all(workers);
  return out;
}

// ===============================
// FETCH MOVIES
// ===============================
async function fetchMovies() {
  const chunks = getDateChunks(DAYS_BACK, CHUNK_SIZE_DAYS);
  const rawResultsMap = new Map();

  for (const chunk of chunks) {
    for (let page = 1; page <= MAX_PAGES_PER_CHUNK; page++) {
      const url =
        `https://api.themoviedb.org/3/discover/movie?` +
        `api_key=${TMDB_KEY}` +
        `&language=en-US` +
        `&with_original_language=en` +
        `&vote_count.gte=${MIN_VOTE_COUNT}` +
        `&sort_by=release_date.desc` +
        `&release_date.gte=${chunk.from}` +
        `&release_date.lte=${chunk.to}` +
        `&without_genres=27` +
        `&page=${page}`;

      const j = await fetchJSON(url);
      if (!j?.results?.length) break;

      for (const movie of j.results) {
        if (!rawResultsMap.has(movie.id)) {
          rawResultsMap.set(movie.id, movie);
        }
      }

      if (page >= j.total_pages) break;
    }
  }

  const rawList = Array.from(rawResultsMap.values());

  const mapped = await pMap(rawList, async (m) => {
    if (!m?.id) return null;

    const releaseDate = await getEffectiveReleaseDate(m);

    if (!releaseDate) return null;
    if (!isAllowed(releaseDate)) return null;

    return {
      id: `tmdb:${m.id}`,
      type: "movie",
      name: m.title || m.original_title || `Movie ${m.id}`,
      description: m.overview || "",
      poster: m.poster_path
        ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
        : null,
      releaseInfo: releaseDate,
    };
  });

  const seen = new Set();
  const out = [];

  for (const item of mapped) {
    if (!item) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }

  return out.sort((a, b) => {
    return new Date(b.releaseInfo) - new Date(a.releaseInfo);
  });
}

// ===============================
// META BUILDER
// ===============================
async function buildMeta(id) {
  const tmdbId = id.startsWith("tmdb:") ? id.split(":")[1] : id;
  if (!tmdbId) return null;

  const movie = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`
  );

  if (!movie) return null;

  return {
    meta: {
      id: `tmdb:${movie.id}`,
      type: "movie",
      name: movie.title,
      description: movie.overview || "",
      poster: movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
      background: movie.backdrop_path
        ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
        : null,
      released: movie.release_date
        ? movie.release_date.slice(0, 10)
        : null,
      imdb: movie.imdb_id || null,
    },
  };
}

// ===============================
// BUILD
// ===============================
async function build() {
  console.log("Fetching movies…");

  const movies = await fetchMovies();

  fs.mkdirSync("./catalog/movie", { recursive: true });
  fs.mkdirSync("./meta/movie", { recursive: true });

  fs.writeFileSync(
    "./catalog/movie/new_releases.json",
    JSON.stringify({ metas: movies }, null, 2)
  );

  for (const m of movies) {
    const meta = await buildMeta(m.id);
    if (!meta) continue;

    fs.writeFileSync(
      `./meta/movie/${m.id}.json`,
      JSON.stringify(meta, null, 2)
    );
  }

  console.log("Done.");
}

build();
