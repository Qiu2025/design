import { Button } from "@/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/dialog";
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
        <Button variant="transparent" className="gap-2" aria-label="About Metadata Remover">
          <Info02Icon />
          <span className="hidden md:inline">About</span>
        </Button>
      </DialogTrigger>
      <DialogContent size="large" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex flex-col gap-2 pr-8">
          <DialogTitle>About Metadata Remover</DialogTitle>
          <DialogDescription>Inspect, choose and remove metadata from one image or video at a time.</DialogDescription>
        </div>
        <div className="grid gap-7 md:grid-cols-2">
          <div className="flex flex-col gap-3 text-[13px] text-gray-11 leading-relaxed">
            <h3 className="font-medium text-gray-12">How it works</h3>
            <p>
              Safe cleaning targets personal, location, date, device and history data. Maximum cleaning also removes
              remaining non-functional fields. Protected fields cannot be selected.
            </p>
            <p>
              Browse groups or search across field names, values and categories. Selecting individual fields or a
              filtered group switches the cleaning level to Custom.
            </p>
            <p>
              After cleaning, SnapBox inspects the result again. A verified result downloads automatically; unresolved
              fields pause the download so you can review it first.
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
            <h3 className="font-medium text-gray-12">Privacy &amp; compatibility</h3>
            <p>
              Images always stay on your device. Videos use the local engine by default; the optional server fallback
              asks for explicit consent, accepts files up to 250 MB and deletes temporary files after the response.
            </p>
            <p>
              JPEG, PNG and WebP are supported locally. GIF, TIFF, BMP and SVG are exported only when their format,
              animation or vector behavior can be preserved. Video support depends on its container and your device.
            </p>
            <p>
              Orientation, color profiles, animation, playback information and stream structure stay protected so the
              cleaned file continues to look and work correctly.
            </p>
            <p>
              Files exist only in memory during the page session. Reloading, closing or removing a file forgets them.
              SnapBox does not inspect pixels, audio, subtitles, attachments or other media content.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
