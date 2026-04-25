import { Button } from "@/components/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/dialog";
import { Shortcut } from "@/components/kbd";
import useHotkeys from "@/utils/useHotkeys";
import { BrandGithubIcon, Info02Icon } from "@raycast/icons";
import { useCallback, useState } from "react";
import usePngClipboardSupported from "../util/usePngClipboardSupported";

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
            <p>Code Images is a tool to create beautiful screenshots of your code.</p>
            <p>
              Pick a theme from a range of syntax colors and backgrounds, the language of your code and choose between
              light or dark mode.
            </p>
            <p>
              Customize the padding and when you’re ready, click export image in the top-right corner to save the image
              as a png, svg or share a link to your code.
            </p>
            <p>You can also change the image resolution in the export menu.</p>
            <a
              href="https://github.com/Qiu2025/ray-so"
              className="inline-flex w-fit items-center gap-2 text-gray-12 underline underline-offset-2"
            >
              <BrandGithubIcon className="h-4 w-4" />
              github.com/Qiu2025/ray-so
            </a>
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="font-medium -mt-[3px]">Shortcuts</h2>
            <div className="flex flex-col gap-4">
              <Shortcut keys={["C"]}>Change colors</Shortcut>
              <Shortcut keys={["B"]}>Toggle background</Shortcut>
              <Shortcut keys={["D"]}>Toggle dark mode</Shortcut>
              <Shortcut keys={["N"]}>Toggle line numbers</Shortcut>
              <Shortcut keys={["P"]}>Change padding</Shortcut>
              <Shortcut keys={["⌥", "click"]}>Highlight line</Shortcut>
              <Shortcut keys={["Ctrl", "F"]}>Format code</Shortcut>
              <Shortcut keys={["⌘", "S"]}>Save PNG</Shortcut>
              <Shortcut keys={["⌘", "⇧", "S"]}>Save SVG</Shortcut>
              {pngClipboardSupported && <Shortcut keys={["⌘", "C"]}>Copy image</Shortcut>}
              <Shortcut keys={["⌘", "⇧", "C"]}>Copy URL</Shortcut>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
