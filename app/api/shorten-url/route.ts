import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const SHORT_LINK_PUBLIC_DOMAIN = "snap.sqiu.dev";
const SHLINK_SHORT_DOMAIN = process.env.SHORT_URL_DOMAIN || "go.sqiu.dev";
const SHLINK_API_KEY = process.env.SHLINK_API_KEY;

const getShlinkBaseUrl = () => {
  const configured = process.env.SHLINK_BASE_URL;

  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fallback to short domain when env value is malformed.
    }
  }

  return `https://${SHLINK_SHORT_DOMAIN}`;
};

const shlinkBaseUrl = getShlinkBaseUrl();

const getCanonicalAppOrigin = () => {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;

  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fallback to the public domain when env value is malformed.
    }
  }

  return `https://${SHORT_LINK_PUBLIC_DOMAIN}`;
};

const canonicalAppOrigin = getCanonicalAppOrigin();

const refs = ["codeImage", "icons", "desktopClient"] as const;

export type refProps = (typeof refs)[number];

const isRef = (value: string | null): value is refProps => {
  return value !== null && refs.some((ref) => ref === value);
};

const createShortLink = async (destinationUrl: string, ref?: refProps) => {
  if (!SHLINK_API_KEY) {
    throw new Error("SHLINK_API_KEY is not configured");
  }

  const payload: Record<string, unknown> = {
    longUrl: destinationUrl,
    domain: SHLINK_SHORT_DOMAIN,
  };

  if (ref) {
    payload.tags = [ref];
  }

  const response = await fetch(`${shlinkBaseUrl}/rest/v3/short-urls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": SHLINK_API_KEY,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Shlink responded with status ${response.status}`);
  }

  const data = (await response.json()) as { shortUrl?: string };

  if (!data.shortUrl) {
    throw new Error("Shlink response missing shortUrl");
  }

  return data.shortUrl;
};

const normalizeDestinationUrl = (url: URL) => {
  const isLocalhost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname.startsWith("192.168.");

  if (!isLocalhost) {
    return url.href;
  }

  const normalized = new URL(url.href);
  const canonical = new URL(canonicalAppOrigin);
  normalized.protocol = canonical.protocol;
  normalized.host = canonical.host;

  return normalized.href;
};

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const urlQuery = searchParams.get("url");
  const refQuery = searchParams.get("ref");

  if (!urlQuery) {
    return NextResponse.json({ error: "Missing URL" }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(urlQuery);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const ref = isRef(refQuery) ? refQuery : undefined;
  const destinationUrl = normalizeDestinationUrl(url);

  if (
    url.hostname.endsWith(SHORT_LINK_PUBLIC_DOMAIN) ||
    url.hostname.endsWith(SHLINK_SHORT_DOMAIN) ||
    url.hostname.includes("raycastapp.vercel.app") ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname.startsWith("192.168.")
  ) {
    try {
      const shortUrl = await createShortLink(destinationUrl, ref);
      return NextResponse.json({ link: shortUrl });
    } catch {
      // Fallback: keep the original long URL when shortener is unavailable.
      return NextResponse.json({ link: destinationUrl });
    }
  }

  return NextResponse.json({ error: "Unable to shorten this link" }, { status: 400 });
}
