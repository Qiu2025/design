const imageFilter = (node: HTMLElement) => node.tagName !== "TEXTAREA" && !node.dataset?.ignoreInExport;

const htmlToImageOptions = {
  filter: imageFilter,
  pixelRatio: 2,
  skipAutoScale: true,
};

type Options = { filter?: (node: HTMLElement) => boolean; pixelRatio?: number; skipAutoScale?: boolean; style?: any };

export const toPng = async (node: HTMLElement, options?: Options) => {
  const { toPng: htmlToPng } = await import("html-to-image");
  // sometimes the first render doesn't work fully so we do the rendering twice https://github.com/bubkoo/html-to-image/issues/361
  await htmlToPng(node, {
    ...htmlToImageOptions,
    ...options,
  });
  return htmlToPng(node, {
    ...htmlToImageOptions,
    ...options,
  });
};

export const toBlob = async (node: HTMLElement, options?: Options) => {
  const { toBlob: htmlToBlob } = await import("html-to-image");
  return htmlToBlob(node, {
    ...htmlToImageOptions,
    ...options,
  });
};

export const toSvg = async (node: HTMLElement, options?: Options) => {
  const { toSvg: htmlToSvg } = await import("html-to-image");
  return htmlToSvg(node, {
    ...htmlToImageOptions,
    ...options,
  });
};
