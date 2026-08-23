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
              SnapBox classifies the metadata it can detect. Safe cleaning selects fields classified as sensitive;
              Maximum selects every field not classified as protected. The classification is heuristic, and protected
              fields cannot be selected.
            </p>
            <p>
              Browse groups or search across field names, values and categories. Selecting individual fields or a
              filtered group switches the cleaning level to Custom.
            </p>
            <p>
              After cleaning, SnapBox inspects the result again. A verified result means that none of the selected,
              listed fields were found and downloads automatically. If a selected field remains, the download pauses so
              you can review it first.
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
              Images are processed only in your browser. Videos use the local engine first; the optional server fallback
              asks for explicit consent, accepts files up to 250 MB and attempts to remove its temporary files after an
              error or when the response ends.
            </p>
            <p>
              JPEG, PNG and WebP are the preferred local image formats. GIF, TIFF, BMP and SVG are best-effort formats:
              the tool returns an output only when the local engine succeeds, but cannot guarantee every format-specific
              behavior is unchanged. Local video support depends on the container and available browser memory.
            </p>
            <p>
              Fields that appear necessary for display or playback are protected by a conservative classifier.
              Verification covers only the selected tags listed by SnapBox; it does not prove that every
              application-specific field or embedded payload was removed.
            </p>
            <p>
              With local processing, the selected file and result remain in your browser and are not uploaded. Server
              processing temporarily uploads the video. Video cleaning remuxes without re-encoding and removes only the
              file, track and chapter tags listed here. It preserves media, subtitle, attachment and data payloads,
              codec side data and metadata embedded inside those payloads.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
