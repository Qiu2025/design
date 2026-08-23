import type { Metadata } from "next";

import { MockupMaker } from "./mockup-maker";

const pageTitle = "Mockup Maker";
const pageDescription = "Place screenshots inside phone, tablet and laptop device frames.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  openGraph: {
    url: "/mockup",
    title: pageTitle,
    description: pageDescription,
  },
  twitter: {
    title: pageTitle,
    description: pageDescription,
  },
  keywords: "mockup, device mockup, screenshot, phone, tablet, laptop",
};

export default function Page() {
  return <MockupMaker />;
}
