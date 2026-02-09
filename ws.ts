import { serve } from "https://deno.land/std@0.196.0/http/server.ts";

serve(async (req) => {
  const url = new URL(req.url);

  // Proxy toda petición hacia el mismo path en backend
  const backendUrl = `https://hostinger.ravikumar.live${url.pathname}${url.search}`;
  const newHeaders = new Headers(req.headers);
  newHeaders.delete("host");

  const backendResp = await fetch(backendUrl, {
    method: req.method,
    headers: newHeaders,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
  });

  const respBody = await backendResp.arrayBuffer();
  const headers = new Headers(backendResp.headers);

  // Anti-caché global en TODAS las respuestas
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");

  return new Response(respBody, {
    status: backendResp.status,
    statusText: backendResp.statusText,
    headers,
  });
});

