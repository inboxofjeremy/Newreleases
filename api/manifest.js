export const config = { runtime: "edge" };

const manifest = {
  id: "recent_movies",
  version: "1.0.0",
  name: "Recent Hollywood Releases",
  description: "Hollywood theatrical, streaming, and VOD movies from the last 90 days",
  catalogs: [
    {
      id: "recent_movies",
      name: "Recent Movies",
      type: "movie"
    }
  ],
  resources: ["catalog"],
  types: ["movie"]
};

export default async function handler() {
  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
