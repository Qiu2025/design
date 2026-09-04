import { Button } from "@/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/dialog";
import { BrandGithubIcon, Info02Icon } from "@raycast/icons";
import { Shortcut } from "@/components/kbd";
import { useCallback, useState } from "react";
import useHotkeys from "@/utils/useHotkeys";

export function InfoDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const toggleOpen = useCallback(() => setIsOpen((prev) => !prev), [setIsOpen]);

  useHotkeys("shift+/", toggleOpen);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="transparent" className="gap-2" aria-label="About Icon Maker">
          <Info02Icon />
          <span className="hidden md:inline">About</span>
        </Button>
      </DialogTrigger>
      <DialogContent size="large">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-3 text-[13px] text-gray-11 leading-relaxed">
            <DialogTitle>About</DialogTitle>
            <DialogDescription className="text-[13px] text-gray-11 leading-relaxed">
              Icon Maker is a tool to easily create and export icons.
            </DialogDescription>
            <p>
              Search for an icon or import your’s, change the color of the icon, and customize the background to create
              a beautifully simple icon.
            </p>
            <p>Edit the file name, and when you’re ready, click export icon in the top-right corner to export.</p>
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
              <Shortcut keys={["⌘", "Z"]}>Undo action</Shortcut>
              <Shortcut keys={["Ctrl", "Y"]}>Redo action</Shortcut>
              <Shortcut keys={["⌘", "F"]}>Search icons</Shortcut>
              <Shortcut keys={["⌘", "."]}>Toggle interface</Shortcut>
              <Shortcut keys={["Ctrl", "S"]}>Save icon</Shortcut>
              <Shortcut keys={["⌘", "C"]}>Copy image</Shortcut>
              <Shortcut keys={["⌘", "shift", "C"]}>Copy URL</Shortcut>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
