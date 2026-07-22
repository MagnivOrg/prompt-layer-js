/** Shared helpers for HTTP mock tests. */

export const jsonResponse = (data: unknown, status: number): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const getUrlString = (input: string | URL): string => String(input);
