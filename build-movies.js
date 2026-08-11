import fs from "fs";

// ===============================
// CONFIG
// ===============================
const TMDB_KEY = process.env.TMDB_API_KEY;

if (!TMDB_KEY) {
  console.error("ERROR: TMDB_API_KEY environment variable is not set.");
  process.exit(1);
}

const DAYS_BACK = 180;
const MAX_PAGES_PER_CHUNK = 20;
const TMDB_CONCURRENCY = 8;
const MIN_VOTE_COUNT = 5;

// ===============================
// DATE HELPERS
// ===============================
function getDateChunks(totalDaysBack = DAYS_BACK, chunkSizeDays = 30) {
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
// ALLOW WINDOW CHECK
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
// US RELEASE DATE & DETAILS HELPER
// ===============================
async function fetchMovieDetailsAndRelease(id) {
  const [releaseJson, detailJson] = await Promise.all([
    fetchJSON(`https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`),
    fetchJSON(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}&language=en-US`)
  ]);

  if (!detailJson || !detailJson.imdb_id) return null;

  let targetDate = null;
  if (releaseJson?.results?.length) {
    const us = releaseJson.results.find((r) => r.iso_3166_1 === "US");
    if (us?.release_dates?.length) {
      const digitalDates = us.release_dates
        .filter((d) => d.type === 4 && d.release_date)
        .map((d) => d.release_date.slice(0, 10))
        .sort();

      if (digitalDates.length) {
        targetDate = digitalDates[0];
      } else {
        const allUsDates = us.release_dates
          .filter((d) => d.release_date)
          .map((d) => d.release_date.slice(0, 10))
          .sort();
        if (allUsDates.length) targetDate = allUsDates[allUsDates.length - 1];
      }
    }
  }

  if (!targetDate && detailJson.release_date) {
    targetDate = detailJson.release_date.slice(0, 10);
  }

  if (!targetDate || !isAllowed(targetDate)) return null;

  return {
    imdb_id: detailJson.imdb_id,
    releaseInfo: targetDate,
    title: detailJson.title || detailJson.original_title,
    overview: detailJson.overview,
    poster_path: detailJson.poster_path
  };
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
  const chunks = getDateChunks(DAYS_BACK, 30);
  const rawResultsMap = new Map();

  for (const chunk of chunks) {
    for (let page = 1; page <= MAX_PAGES_PER_CHUNK; page++) {
      const url =
        `https://api.themoviedb.org/3/discover/movie?` +
        `api_key=${TMDB_KEY}` +
        `&language=en-US` +
        `&with_original_language=en` +
        `&region=US` +
        `&vote_count.gte=${MIN_VOTE_COUNT}` +
        `&sort_by=primary_release_date.desc` +
        `&primary_release_date.gte=${chunk.from}` +
        `&primary_release_date.lte=${chunk.to}` +
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

    const details = await fetchMovieDetailsAndRelease(m.id);
    if (!details) return null;

    return {
      id: details.imdb_id,
      type: "movie",
      name: details.title || `Movie ${m.id}`,
      description: details.overview || "",
      poster: details.poster_path
        ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
        : null,
      releaseInfo: details.releaseInfo,
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

  return out.sort((a, b) => new Date(b.releaseInfo) - new Date(a.releaseInfo));
}

// ===============================
// BUILD
// ===============================
async function build() {
  console.log("Fetching movies…");

  const movies = await fetchMovies();

  fs.mkdirSync("./catalog/movie", { recursive: true });

  fs.writeFileSync(
    "./catalog/movie/new_releases.json",
    JSON.stringify({ metas: movies }, null, 2)
  );

  console.log("Done.");
}

build();
