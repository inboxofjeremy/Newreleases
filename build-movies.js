async function fetchUSReleaseDate(id) {
  const json = await fetchJSON(
    `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_KEY}`
  );

  if (!json?.results) return null;

  const us = json.results.find((r) => r.iso_3166_1 === "US");
  if (!us?.release_dates?.length) return null;

  const digitalDates = us.release_dates
    .filter((d) => d.type === 4 && d.release_date)
    .map((d) => d.release_date.slice(0, 10))
    .sort(); // ascending (earliest → latest)

  if (digitalDates.length) {
    return digitalDates[0]; // ✅ EARLIEST digital
  }

  const theatricalDates = us.release_dates
    .filter((d) => d.type === 3 && d.release_date)
    .map((d) => d.release_date.slice(0, 10))
    .sort();

  if (theatricalDates.length) {
    return theatricalDates[0];
  }

  const all = us.release_dates
    .map((d) => d.release_date?.slice(0, 10))
    .filter(Boolean)
    .sort();

  return all[0] || null;
}
