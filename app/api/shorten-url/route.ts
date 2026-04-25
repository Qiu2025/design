import { NextRequest, NextResponse } from "next/server";
import { Dub } from "dub";

// Note: This route requires DUB_TOKEN and cannot be truly static
// It will be prerendered but may fail during build if token is missing
export const runtime = "edge";

const dub = new Dub({
  token: process.env.DUB_TOKEN,
});

const SHORT_LINK_PUBLIC_DOMAIN = "snap.sqiu.dev";
const DUB_LINK_DOMAIN = "go.sqiu.dev";

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

const tagIdsByRef = {
  codeImage: "clsokhlen0001kz0gxlqfgpp0",
  icons: "cltyfpaho0001lwxwdcd93mkc",
  desktopClient: "tag_LmjLVKbcZB45xNbcgNPLV0Hh",
};

export type refProps = keyof typeof tagIdsByRef;

const getTagId = (ref: refProps) => {
  return ref ? tagIdsByRef[ref] : undefined;
};

const createShortLink = async (destinationUrl: string, tagId?: string) => {
  const link = await dub.links.create({
    url: destinationUrl,
    domain: DUB_LINK_DOMAIN,
    ...(tagId ? { tagIds: [tagId] } : {}),
  });

  if (!link?.key) {
    throw new Error("Dub response missing key");
  }

  return link.key;
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

  const tagId = refQuery ? getTagId(refQuery as refProps) : undefined;
  const destinationUrl = normalizeDestinationUrl(url);

  if (
    url.hostname.endsWith(SHORT_LINK_PUBLIC_DOMAIN) ||
    url.hostname.endsWith(DUB_LINK_DOMAIN) ||
    url.hostname.includes("raycastapp.vercel.app") ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname.startsWith("192.168.")
  ) {
    try {
      const key = await createShortLink(destinationUrl, tagId);
      return NextResponse.json({ link: `https://${DUB_LINK_DOMAIN}/${key}` });
    } catch {
      // Fallback: if tag IDs are invalid for this Dub workspace, retry without tags.
      try {
        const key = await createShortLink(destinationUrl);
        return NextResponse.json({ link: `https://${DUB_LINK_DOMAIN}/${key}` });
      } catch {
        return NextResponse.json({ error: "Unable to shorten this link" }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ error: "Unable to shorten this link" }, { status: 400 });
}
