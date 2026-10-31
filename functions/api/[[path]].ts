interface Env {
  API_ORIGIN: string;
}

interface PagesRequestContext {
  request: Request;
  env: Env;
}

export async function onRequest({ request, env }: PagesRequestContext): Promise<Response> {
  const origin = env.API_ORIGIN.replace(/\/+$/, "");
  const incoming = new URL(request.url);
  const upstream = new URL(`${incoming.pathname}${incoming.search}`, origin);
  const headers = new Headers(request.headers);
  headers.set("X-Forwarded-Host", incoming.host);
  headers.set("X-Forwarded-Proto", incoming.protocol.slice(0, -1));

  return fetch(
    new Request(upstream, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    }),
  );
};
