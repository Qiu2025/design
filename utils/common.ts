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
    return "https://design.sqiu.dev";
  }

  return "http://localhost:3000";
};

export const BASE_URL = resolveBaseUrl();
