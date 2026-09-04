import type { Metadata } from "next";
import { Suspense } from "react";
import { MetadataRemover } from "./metadata-remover";

const pageTitle = "Metadata Remover";
const pageDescription =
  "Inspect, remove and verify listed metadata tags in images and videos with a local-first workflow.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  openGraph: {
    url: "/metadata",
    title: pageTitle,
    description: pageDescription,
  },
  twitter: {
    title: pageTitle,
    description: pageDescription,
  },
  keywords: "metadata, exif, xmp, iptc, video, image, privacy, remove metadata",
};

export default function Page() {
  return (
    <Suspense>
      <MetadataRemover />
    </Suspense>
  );
}
