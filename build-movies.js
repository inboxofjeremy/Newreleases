import fs from "fs";

// ===============================
// CONFIG
// ===============================
const TMDB_KEY = "YOUR_TMDB_API_KEY";
const DAYS_BACK = 180;
const MIN_VOTE_COUNT = 3; // Lowered slightly so new indie VODs aren't dropped
const EARLIEST_ORIGINAL_YEAR = 2024; // Blocks old catalog movies (Mars Attacks, etc.)

// ===============================
// HELPERS
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

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

// Generate 30-day time chunks going back DAYS_BACK
function getDateChunks(totalDaysBack, chunkSizeDays = 30) {
  const chunks = [];
  let currentEnd = new Date();

  // Allow +2 days for timezone/preview padding
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
      from: formatDate(currentStart),
      to: formatDate(currentEnd),
    });

    currentEnd = new Date(currentStart);
  }

  return chunks;
}

// Extract the best US release date (Digital > Theatrical)
async function getUSReleaseDate(movieId) {
  const json = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${movieId}/release_dates?api_key=${TMDB_KEY}`
  );

  if (!json?.results?.length) return null;

  const us = json.results.find((r) => r.iso_3166_1 === "US");
  if (!us?.release_dates?.length) return null;

  // 1. Digital (Type 4)
  const digital = us.release_dates
    .filter((d) => d.type === 4 && d.release_date)
    .map((d) => d.release_date.slice(0, 10))
    .sort();

  if (digital.length) return { date: digital[0], type: "Digital" };

  // 2. Theatrical (Type 3) or Limited (Type 2)
  const theatrical = us.release_dates
    .filter((d) => (d.type === 3 || d.type === 2) && d.release_date)
    .map((d) => d.release_date.slice(0, 10))
    .sort();

  if (theatrical.length) return { date: theatrical[0], type: "Theatrical" };

  return null;
}

// ===============================
// MAIN SCRAPER
// ===============================
async function buildTrustedCatalog() {
  console.log("Starting multi-pass fetch...");
  const dateChunks = getDateChunks(DAYS_BACK, 30);
  const foundMovies = new Map();

  for (const chunk of dateChunks) {
    console.log(`Fetching chunk: ${chunk.from} to ${chunk.to}`);

    // Query each 30-day window specifically
    const url =
      `https://api.themoviedb.org/3/discover/movie?` +
      `api_key=${TMDB_KEY}` +
      `&language=en-US` +
      `&with_original_language=en` +
      `&region=US` +
      `&with_release_type=4|3` +
      `&vote_count.gte=${MIN_VOTE_COUNT}` +
      `&sort_by=release_date.desc` +
      `&release_date.gte=${chunk.from}` +
      `&release_date.lte=${chunk.to}` +
      `&without_genres=27`; // Exclude Horror if desired, or remove

    const data = await fetchJSON(url);
    if (!data?.results) continue;

    for (const movie of data.results) {
      if (foundMovies.has(movie.id)) continue;

      // RULE 1: Primary Year Filter (Blocks vintage re-releases)
      const primaryYear = movie.release_date
        ? parseInt(movie.release_date.slice(0, 4), 10)
        : 0;

      if (primaryYear < EARLIEST_ORIGINAL_YEAR) {
        continue; // Drops Mars Attacks! (1996)
      }

      // RULE 2: Get precise US date
      const usRelease = await getUSReleaseDate(movie.id);
      if (!usRelease) continue;

      foundMovies.set(movie.id, {
        id: `tmdb:${movie.id}`,
        type: "movie",
        name: movie.title,
        description: movie.overview || "",
        poster: movie.poster_path
          ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
          : null,
        releaseInfo: usRelease.date,
        releaseType: usRelease.type,
        originalYear: primaryYear,
      });
    }
  }

  // Convert map to array and sort newest first
  const catalog = Array.from(foundMovies.values()).sort(
    (a, b) => new Date(b.releaseInfo) - new Date(a.releaseInfo)
  );

  console.log(`\nSuccess! Trustworthy Catalog Built: ${catalog.length} movies.`);

  // Write outputs
  fs.mkdirSync("./catalog/movie", { recursive: true });
  fs.writeFileSync(
    "./catalog/movie/new_releases.json",
    JSON.stringify({ metas: catalog }, null, 2)
  );
}

buildTrustedCatalog();
