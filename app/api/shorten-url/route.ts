import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const SHORT_LINK_PUBLIC_DOMAIN = "design.sqiu.dev";

const DEFAULT_SHLINK_BASE_URL = "https://go.sqiu.dev";

const readEnv = (value: string | undefined) => {
  const trimmed = value?.trim();

  if (!trimmed) {
    return trimmed;
  }

  const wrappedInDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"');
  const wrappedInSingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'");

  if (wrappedInDoubleQuotes || wrappedInSingleQuotes) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const getShlinkConfig = () => {
  const configured = readEnv(process.env.SHLINK_BASE_URL) || DEFAULT_SHLINK_BASE_URL;
  const configuredShortDomain = readEnv(process.env.SHLINK_SHORT_DOMAIN);

  try {
    const parsed = new URL(configured);
    return {
      shlinkBaseUrl: parsed.origin,
      shlinkShortDomain: configuredShortDomain || parsed.hostname,
    };
  } catch {
    return {
      shlinkBaseUrl: DEFAULT_SHLINK_BASE_URL,
      shlinkShortDomain: configuredShortDomain || new URL(DEFAULT_SHLINK_BASE_URL).hostname,
    };
  }
};

const { shlinkBaseUrl, shlinkShortDomain } = getShlinkConfig();

const getShlinkApiKey = () => readEnv(process.env.SHLINK_API_KEY);

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
  return value !== null && refs.includes(value as refProps);
};

const requestShlinkShortUrl = async (payload: Record<string, unknown>, shlinkApiKey: string) => {
  const response = await fetch(`${shlinkBaseUrl}/rest/v3/short-urls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": shlinkApiKey,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Shlink responded with status ${response.status}: ${errorBody}`);
  }

  const data = (await response.json()) as { shortUrl?: string };

  if (!data.shortUrl) {
    throw new Error("Shlink response missing shortUrl");
  }

  return data.shortUrl;
};

const createShortLink = async (destinationUrl: string, ref?: refProps) => {
  const shlinkApiKey = getShlinkApiKey();

  if (!shlinkApiKey) {
    throw new Error("SHLINK_API_KEY is not configured");
  }

  const payload: Record<string, unknown> = { longUrl: destinationUrl };

  if (ref) {
    payload.tags = [ref];
  }

  try {
    return await requestShlinkShortUrl({ ...payload, domain: shlinkShortDomain }, shlinkApiKey);
  } catch (error) {
    // Some Shlink setups reject unknown domains; retry without forcing a specific one.
    console.warn("Shlink domain-specific shorten failed. Retrying without domain.", {
      shlinkShortDomain,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return requestShlinkShortUrl(payload, shlinkApiKey);
  }
};

const normalizeDestinationUrl = (url: URL) => {
  const isLocalhost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname.startsWith("192.168.");

  // Keep localhost URLs as-is, don't normalize them
  if (isLocalhost) {
    return url.href;
  }

  // For non-localhost URLs, keep them as-is as well
  return url.href;
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
    url.hostname.endsWith(shlinkShortDomain) ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname.startsWith("192.168.")
  ) {
    try {
      const shortUrl = await createShortLink(destinationUrl, ref);
      return NextResponse.json({ link: shortUrl });
    } catch (error) {
      console.error("Shlink shorten failed. Returning long URL fallback.", {
        shlinkBaseUrl,
        shlinkShortDomain,
        destinationUrl,
        ref,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      // Fallback: keep the original long URL when shortener is unavailable.
      return NextResponse.json({ link: destinationUrl });
    }
  }

  return NextResponse.json({ error: "Unable to shorten this link" }, { status: 400 });
}
