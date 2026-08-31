import { Button } from "@/components/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/dialog";
import { Shortcut } from "@/components/kbd";
import useHotkeys from "@/utils/useHotkeys";
import { BrandGithubIcon, Info02Icon } from "@raycast/icons";
import { useCallback, useState } from "react";
import usePngClipboardSupported from "../../(code)/util/usePngClipboardSupported";

export function InfoDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const toggleOpen = useCallback(() => setIsOpen((prev) => !prev), [setIsOpen]);
  const pngClipboardSupported = usePngClipboardSupported();

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
            <p>Mockup Maker is a tool to turn your screenshots into device mockups.</p>
            <p>
              Upload or paste a screenshot, choose a phone, tablet or laptop frame, and adjust the image to fit the
              screen.
            </p>
            <p>
              Customize the device, background and canvas space, then export your mockup as a PNG or SVG from the
              top-right corner.
            </p>
            <a
              href="https://github.com/Qiu2025/design"
              className="inline-flex w-fit items-center gap-2 text-gray-12 underline underline-offset-2"
            >
              <BrandGithubIcon className="h-4 w-4" />
              github.com/Qiu2025/design
            </a>
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="font-medium -mt-[3px]">Shortcuts</h2>
            <div className="flex flex-col gap-4">
              <Shortcut keys={["⌘", "S"]}>Save PNG</Shortcut>
              <Shortcut keys={["⌘", "⇧", "S"]}>Save SVG</Shortcut>
              {pngClipboardSupported && <Shortcut keys={["⌘", "C"]}>Copy Mockup</Shortcut>}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
