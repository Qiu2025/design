import { refProps } from "@/app/api/shorten-url/route";

const resolveBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }

  if (process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" && process.env.NEXT_PUBLIC_VERCEL_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
  }

  if (process.env.NEXT_PUBLIC_VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    return "https://snap.sqiu.dev";
  }

  return "http://localhost:3000";
};

export const BASE_URL = resolveBaseUrl();

export async function shortenUrl(url: string, ref: refProps) {
  const endpoint =
    globalThis.window === undefined
      ? `${BASE_URL}/api/shorten-url?url=${encodeURIComponent(url)}&ref=${ref}`
      : `/api/shorten-url?url=${encodeURIComponent(url)}&ref=${ref}`;

  const response = await fetch(endpoint).then((res) => res.json());

  if (response.link) {
    return response.link as string;
  }

  console.error("Failed to shorten URL", response);

  throw new Error("Unable to shorten this link");
}
