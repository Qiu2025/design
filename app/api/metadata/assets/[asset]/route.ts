import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ASSETS: Record<string, { path: string; contentType: string }> = {
  "zeroperl.wasm": {
    path: join(process.cwd(), "node_modules/@6over3/zeroperl-ts/dist/esm/zeroperl.wasm"),
    contentType: "application/wasm",
  },
  "ffmpeg-core.js": {
    path: join(process.cwd(), "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js"),
    contentType: "text/javascript; charset=utf-8",
  },
  "ffmpeg-core.wasm": {
    path: join(process.cwd(), "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm"),
    contentType: "application/wasm",
  },
};

export async function GET(_request: Request, context: { params: Promise<{ asset: string }> }) {
  const { asset } = await context.params;
  const requestedAsset = ASSETS[asset];

  if (!requestedAsset) {
    return NextResponse.json({ error: "Unknown metadata engine asset." }, { status: 404 });
  }

  const body = await readFile(/* turbopackIgnore: true */ requestedAsset.path);

  return new NextResponse(body, {
    headers: {
      "Content-Type": requestedAsset.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
