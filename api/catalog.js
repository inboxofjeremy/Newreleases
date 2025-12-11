export const config = {
  runtime: "edge"
};

const TMDB_KEY = "944017b839d3c040bdd2574083e4c1bc";
const DAYS_BACK = 90;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const DATE_FROM = daysAgo(DAYS_BACK);
const DATE_TO = daysAgo(0);

// CORS
function cors(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

// Get release date for US theatrical/streaming/VOD
async function fetchUSRelease(id) {
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`,
      { cache: "no-store" }
    );
    const j = await r.json();
    if (!j.results) return null;

    const us = j.results.find(x => x.iso_3166_1 === "US");
    if (!us) return null;

    // Valid Hollywood release types:
    // 2 = Theatrical (limited)
    // 3 = Theatrical (wide)
    // 4 = Digital
    // 6 = Streaming
    const valid = us.release_dates.filter(r =>
      [2, 3, 4, 6].includes(r.type)
    );

    if (!valid.length) return null;

    const date = valid[0].release_date.split("T")[0];
    return date;
  } catch {
    return null;
  }
}

async function fetchMovies() {
  // Pull the top 2 pages (40 movies), newest first
  const discURL =
    `https://api.themoviedb.org/3/discover/movie?` +
    `api_key=${TMDB_KEY}` +
    `&language=en-US` +
    `&with_original_language=en` +
    `&sort_by=primary_release_date.desc` +
    `&primary_release_date.gte=${DATE_FROM}` +
    `&primary_release_date.lte=${DATE_TO}` +
    `&page=1`;

  const r = await fetch(discURL, { cache: "no-store" });
  const j = await r.json();
  const list = j.results || [];

  // Limit to first 40 to avoid slowdowns
  const trimmed = list.slice(0, 40);

  const movies = await Promise.all(
    trimmed.map(async m => {
      const usDate = await fetchUSRelease(m.id);
      if (!usDate) return null;

      // Must be within valid window
      if (usDate < DATE_FROM || usDate > DATE_TO) return null;

      return {
        id: `tmdb:${m.id}`,
        type: "movie",
        name: m.title,
        description: m.overview || "",
        poster: m.poster_path
          ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
          : null,
        releaseInfo: usDate
      };
    })
  );

  return movies.filter(Boolean);
}

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/catalog/movie/recent_movies.json") {
    try {
      const list = await fetchMovies();
      return cors({ metas: list });
    } catch (err) {
      return cors({ metas: [], error: err.message });
    }
  }

  return cors({ ok: true });
}
