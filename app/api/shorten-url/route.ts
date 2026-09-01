import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

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
  const configured = readEnv(process.env.SHLINK_BASE_URL);
  const configuredShortDomain = readEnv(process.env.SHLINK_SHORT_DOMAIN);

  if (!configured) {
    throw new Error("SHLINK_BASE_URL is not configured");
  }

  try {
    const parsed = new URL(configured);
    return {
      shlinkBaseUrl: parsed.origin,
      shlinkShortDomain: configuredShortDomain || parsed.hostname,
    };
  } catch {
    throw new Error("SHLINK_BASE_URL is invalid");
  }
};

const refs = ["codeImage", "icons", "desktopClient"] as const;

type Ref = (typeof refs)[number];

const isRef = (value: string | null): value is Ref => {
  return value !== null && refs.includes(value as Ref);
};

const getErrorDetails = (error: unknown) => {
  const cause = error instanceof Error && typeof error.cause === "object" ? error.cause : null;
  const causeCode = cause && "code" in cause && typeof cause.code === "string" ? cause.code : undefined;

  return {
    reason: error instanceof Error ? error.message : "Unknown error",
    causeCode,
  };
};

const requestShlinkShortUrl = async (payload: Record<string, unknown>, shlinkApiKey: string, shlinkBaseUrl: string) => {
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
    throw new Error(`Shlink responded with status ${response.status}`);
  }

  const data = (await response.json()) as { shortUrl?: string };

  if (!data.shortUrl) {
    throw new Error("Shlink response missing shortUrl");
  }

  return data.shortUrl;
};

const createShortLink = async (destinationUrl: string, ref?: Ref) => {
  const { shlinkBaseUrl, shlinkShortDomain } = getShlinkConfig();
  const shlinkApiKey = readEnv(process.env.SHLINK_API_KEY);
  const destinationHost = new URL(destinationUrl).hostname;

  console.info("[shorten-url] Sending request to Shlink.", {
    shlinkBaseUrl,
    shlinkShortDomain,
    apiKeyConfigured: Boolean(shlinkApiKey),
    destinationHost,
    ref,
  });

  if (!shlinkApiKey) {
    throw new Error("SHLINK_API_KEY is not configured");
  }

  const payload: Record<string, unknown> = { longUrl: destinationUrl };

  if (ref) {
    payload.tags = [ref];
  }

  try {
    return await requestShlinkShortUrl({ ...payload, domain: shlinkShortDomain }, shlinkApiKey, shlinkBaseUrl);
  } catch (error) {
    console.warn("[shorten-url] Domain-specific request failed; retrying without a domain.", {
      shlinkBaseUrl,
      shlinkShortDomain,
      destinationHost,
      ref,
      ...getErrorDetails(error),
    });
    return requestShlinkShortUrl(payload, shlinkApiKey, shlinkBaseUrl);
  }
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
  const destinationUrl = url.href;
  const logContext = {
    requestHost: req.headers.get("host"),
    forwardedHost: req.headers.get("x-forwarded-host"),
    nextUrlHost: req.nextUrl.hostname,
    destinationHost: url.hostname,
    cfRay: req.headers.get("cf-ray"),
    ref,
  };

  console.info("[shorten-url] Request received.", logContext);

  const isAllowedDestination =
    url.hostname === req.nextUrl.hostname ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname.startsWith("192.168.");

  if (!isAllowedDestination) {
    console.warn("[shorten-url] Request rejected: destination host is not allowed.", logContext);
    return NextResponse.json({ error: "Unable to shorten this link" }, { status: 400 });
  }

  try {
    const shortUrl = await createShortLink(destinationUrl, ref);
    console.info("[shorten-url] Short link created.", logContext);
    return NextResponse.json({ link: shortUrl });
  } catch (error) {
    console.error("[shorten-url] Shortening failed; returning the original URL.", {
      ...logContext,
      ...getErrorDetails(error),
    });
    // Fallback: keep the original long URL when shortener is unavailable.
    return NextResponse.json({ link: destinationUrl });
  }
}
