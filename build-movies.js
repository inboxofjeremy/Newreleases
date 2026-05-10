// build-movies.js
import fs from "fs";
import path from "path";

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc"; // your key
const OUTPUT_DIR = ".";
const DAYS_BACK = 180;
const MAX_PAGES = 20;
const TMDB_CONCURRENCY = 8;
const MIN_VOTE_COUNT = 5;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

async function fetchJSON(url) {
  try {
    console.log(`Fetching: ${url}`); // Added: Log every fetch request
    const r = await fetch(url);
    if (!r.ok) {
      console.error(`Failed fetch (${r.status}): ${url}`); // Added: Log failures
      return null;
    }
    return await r.json();
  } catch (error) {
    console.error(`Error fetching JSON: ${error.message}`, url); // Added: Log network errors
    return null;
  }
}

async function fetchUSReleaseDate(id) {
  const json = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`
  );
  if (!json?.results) return null;

  const us = json.results.find((r) => r.iso_3166_1 === "US");
  if (!us?.release_dates?.length) return null;

  return (
    us.release_dates
      .map((d) => d.release_date?.slice(0, 10))
      .filter(Boolean)
      .sort()[0] || null
  );
}

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
        } catch (error) {
          console.error(`Error in pMap: ${error.message}`, list[idx]); // Added: Log errors in worker
          out[idx] = null;
        }
      }
    });

  await Promise.all(workers);
  return out;
}

function formatFullDate(dateStr) {
  if (!dateStr) return null;

  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;

  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function fetchMovies() {
  console.log(`Fetching movies from ${DATE_FROM} to ${DATE_TO}...`); // Added: Initial log
  const all = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `https://api.themoviedb.org/3/discover/movie?` +
      `api_key=${TMDB_KEY}` +
      `&language=en-US` +
      `&with_original_language=en` +
      `&region=US` +
      `&vote_count.gte=${MIN_VOTE_COUNT}` +
      `&sort_by=primary_release_date.desc` +
      `&primary_release_date.gte=${DATE_FROM}` +
      `&primary_release_date.lte=${DATE_TO}` +
      `&without_genres=27` +
      `&page=${page}`;

    const j = await fetchJSON(url);
    if (!j?.results?.length) {
      console.warn(`No results on page ${page} or stopping early`); // Added: Warn for empty pages
      break;
    }

    all.push(...j.results);
    if (page >= j.total_pages) break;
  }

  console.log(`Found ${all.length} movies to process.`); // Added: Log total results

  const mapped = await pMap(
    all,
    async (m) => {
      if (!m?.id) return null;

      const usDate = await fetchUSReleaseDate(m.id);
      console.log(`Movie ID: ${m.id}, US Release Date: ${usDate}`); // Added: Log US release date
      if (!usDate) return null;
      if (usDate < DATE_FROM || usDate > DATE_TO) return null;

      return {
        id: `tmdb:${m.id}`,
        type: "movie",
        name: m.title || m.original_title || `Movie ${m.id}`,
        description: m.overview || "",
        poster: m.poster_path
          ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
          : null,

        releaseInfo: formatFullDate(usDate),
      };
    },
    TMDB_CONCURRENCY