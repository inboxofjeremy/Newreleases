{
  "id": "newreleases",
  "version": "1.0.0",
  "name": "New Releases (Movies)",
  "description": "Recently released movies in theatres, VOD, or streaming (last 90 days).",
  "logo": "https://newreleases-two.vercel.app/icon.png",

  "resources": [
    {
      "name": "catalog",
      "types": ["movie"],
      "id": "recent_movies"
    }
  ],

  "types": ["movie"],

  "catalogs": [
    {
      "id": "recent_movies",
      "type": "movie",
      "name": "New Movie Releases"
    }
  ],

  "idPrefixes": ["tmdb"]
}
