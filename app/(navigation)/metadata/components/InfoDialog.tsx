import { Button } from "@/components/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/dialog";
import useHotkeys from "@/utils/useHotkeys";
import { BrandGithubIcon, Info02Icon } from "@raycast/icons";
import { useCallback, useState } from "react";

export function InfoDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const toggleOpen = useCallback(() => setIsOpen((prev) => !prev), [setIsOpen]);

  useHotkeys("shift+/", toggleOpen);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="transparent" className="hidden md:flex gap-2">
          <Info02Icon /> About
        </Button>
      </DialogTrigger>
      <DialogContent size="large">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-3 text-[13px] text-gray-11 leading-relaxed">
            <DialogTitle>About</DialogTitle>
            <p>Metadata Remover is a tool to remove metadata from images and videos.</p>
            <p>
              Upload an image or video, and the tool will automatically extract all metadata information. Once
              you&apos;ve reviewed what will be removed, click remove metadata to download a clean version of your file.
            </p>
            <p>Supports images in JPEG, PNG, WebP, BMP, GIF, TIFF, and SVG formats, as well as common video formats.</p>
            <a
              href="https://github.com/Qiu2025/snap-box"
              className="inline-flex w-fit items-center gap-2 text-gray-12 underline underline-offset-2"
            >
              <BrandGithubIcon className="h-4 w-4" />
              github.com/Qiu2025/snap-box
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
