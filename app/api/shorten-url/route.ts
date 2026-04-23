import { NextRequest, NextResponse } from "next/server";
import { Dub } from "dub";

// Note: This route requires DUB_TOKEN and cannot be truly static
// It will be prerendered but may fail during build if token is missing
export const runtime = "edge";

const dub = new Dub({
  token: process.env.DUB_TOKEN,
});

const tagIdsByRef = {
  codeImage: "clsokhlen0001kz0gxlqfgpp0",
  snippets: "clsokhqzy0003kz0gxdhcycue",
  prompts: "clsokhzja0006kz0g64z47gfr",
  themes: "clsoki8190008kz0gzajzalh7",
  icons: "cltyfpaho0001lwxwdcd93mkc",
  presets: "clu9ko3n300068tq0zhk7bc7f",
  quicklinks: "cm0qhn6fo000w3dl1i22hcgoz",
  desktopClient: "tag_LmjLVKbcZB45xNbcgNPLV0Hh",
};

export type refProps = keyof typeof tagIdsByRef;

const getTagId = (ref: refProps) => {
  return ref ? tagIdsByRef[ref] : undefined;
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

  if (
    url.hostname.endsWith("snap.sqiu.dev") ||
    url.hostname.includes("raycastapp.vercel.app") ||
    url.hostname === "localhost"
  ) {
    try {
      const link = await dub.links.create({
        url: url.href,
        domain: "go.sqiu.dev",
        ...(tagId ? { tagIds: [tagId] } : {}),
      });
      return NextResponse.json({ link: `https://go.sqiu.dev/${link.key}` });
    } catch {
      // Fallback: if tag IDs are invalid for this Dub workspace, retry without tags.
      const link = await dub.links.create({
        url: url.href,
        domain: "go.sqiu.dev",
      });
      return NextResponse.json({ link: `https://go.sqiu.dev/${link.key}` });
    }
  }

  return NextResponse.json({ error: "Unable to shorten this link" }, { status: 400 });
}


