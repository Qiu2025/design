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
            <p>Metadata Remover cleans one image or video at a time and verifies the result before download.</p>
            <p>
              Images always stay on your device. Videos use the local engine by default; the optional server fallback
              never uploads a file without explicit consent and accepts up to 250 MB.
            </p>
            <p>
              JPEG, PNG and WebP are supported locally. GIF, TIFF, BMP and SVG are exported only when their format,
              animation or vector behavior can be preserved.
            </p>
            <a
              href="https://github.com/Qiu2025/snap-box"
              className="inline-flex w-fit items-center gap-2 text-gray-12 underline underline-offset-2"
            >
              <BrandGithubIcon className="h-4 w-4" />
              github.com/Qiu2025/snap-box
            </a>
          </div>
          <div className="flex flex-col gap-3 text-[13px] text-gray-11 leading-relaxed">
            <DialogTitle>What is protected</DialogTitle>
            <p>
              Orientation, color profiles, animation, playback information and stream structure are protected so the
              cleaned file continues to look and work correctly.
            </p>
            <p>
              SnapBox reports fields it removed, preserved or could not resolve. It does not inspect pixels, audio,
              subtitles, attachments or other media content.
            </p>
            <p>Files exist only in memory during the page session. Reloading, closing or removing a file forgets it.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
