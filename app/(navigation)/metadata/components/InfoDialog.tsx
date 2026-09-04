import { Button } from "@/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/dialog";
import useHotkeys from "@/utils/useHotkeys";
import { BrandGithubIcon, CheckCircleIcon, EraserIcon, Info02Icon, LockIcon } from "@raycast/icons";
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
      <DialogContent size="large">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-3 text-[13px] text-gray-11 leading-relaxed">
            <DialogTitle>About</DialogTitle>
            <DialogDescription className="text-[13px] text-gray-11 leading-relaxed">
              Metadata Remover helps you find and remove hidden information from images and videos.
            </DialogDescription>
            <p>Add a file, review its metadata, choose what to remove, then download a cleaned copy.</p>
            <a
              href="https://github.com/Qiu2025/design"
              className="inline-flex w-fit items-center gap-2 text-gray-12 underline underline-offset-2"
            >
              <BrandGithubIcon className="h-4 w-4" />
              github.com/Qiu2025/design
            </a>
          </div>
          <div className="flex flex-col gap-3">
            <h2 className="font-medium -mt-[3px]">Features</h2>
            <div className="flex gap-3 rounded-md border border-gray-a3 bg-gray-a2/50 p-3">
              <LockIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-11" />
              <div className="flex flex-col gap-1">
                <h3 className="text-[13px] font-medium text-gray-12">Private by default</h3>
                <p className="text-[13px] text-gray-11 leading-relaxed">
                  Images stay in your browser. Videos start locally and ask before server processing.
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-md border border-gray-a3 bg-gray-a2/50 p-3">
              <EraserIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-11" />
              <div className="flex flex-col gap-1">
                <h3 className="text-[13px] font-medium text-gray-12">Flexible cleaning</h3>
                <p className="text-[13px] text-gray-11 leading-relaxed">
                  Choose Safe, Maximum or the individual details you want to remove.
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-md border border-gray-a3 bg-gray-a2/50 p-3">
              <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-11" />
              <div className="flex flex-col gap-1">
                <h3 className="text-[13px] font-medium text-gray-12">Verified results</h3>
                <p className="text-[13px] text-gray-11 leading-relaxed">
                  The cleaned file is checked again before it is downloaded.
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
