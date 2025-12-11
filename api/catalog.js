export const config = { runtime: "edge" };

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 90;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

// ========================
// NEW DISCOVER FUNCTION
// ========================
async function fetchMoviesPage(page) {
  const url =
    `https://api.themoviedb.org/3/discover/movie` +
    `?api_key=${TMDB_KEY}` +
    `&language=en-US` +
    `&with_original_language=en` +
    `&region=US` +
    `&watch_region=US` +
    `&sort_by=primary_release_date.desc` +
    `&primary_release_date.gte=${DATE_FROM}` +
    `&primary_release_date.lte=${DATE_TO}` +
    `&with_release_type=2|3|4|5|6` +
    `&page=${page}`;

  const res = await fetch(url);
  return await res.json();
}

async function fetchMovies() {
  let all = [];

  // get first 5 pages = ~1000 movies (safe)
  for (let p = 1; p <= 5; p++) {
    const data = await fetchMoviesPage(p);
    if (!data?.results?.length) break;

    all.push(...data.results);

    if (p >= data.total_pages) break;
  }

  return all
    .map(m => ({
      id: m.id.toString(),
      type: "movie",
      name: m.title,
      poster: m.poster_path
        ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
        : null,
      description: m.overview || "",
      releaseInfo: m.release_date || ""
    }))
    .filter(Boolean);
}

export default async function handler() {
  try {
    const results = await fetchMovies();

    return new Response(JSON.stringify({ metas: results }, null, 2), {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ metas: [], error: err.message }),
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        }
      }
    );
  }
}
