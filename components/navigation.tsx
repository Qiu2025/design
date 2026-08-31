"use client";

import { useSelectedLayoutSegments } from "next/navigation";
import type { ReactNode } from "react";

import { CheckIcon, ChevronDownIcon, ChevronLeftIcon } from "@raycast/icons";
import Link from "next/link";
import { cn } from "@/utils/cn";
import CodeImagesIcon from "@/app/assets/code-images.svg";
import IconMakerIcon from "@/app/assets/icon-maker.svg";
import MetadataRemoverIcon from "@/app/assets/metadata-remover.svg";
import MockupMakerIcon from "@/app/assets/mockup-maker.svg";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./dropdown-menu";

const NAVIGATION_SIDE_PADDING = 16;
const NAVIGATION_WIDTH = 204;
const NAVIGATION_GAP = 16;
const NAVIGATION_ACTIONS_LEFT = NAVIGATION_SIDE_PADDING + NAVIGATION_WIDTH + NAVIGATION_GAP;

const links = [
  {
    href: "/",
    label: "Code Images",
    description: "Create beautiful images of your code",
    icon: CodeImagesIcon,
  },
  {
    href: "/icon",
    label: "Icon Maker",
    description: "Create beautiful icons",
    icon: IconMakerIcon,
  },
  {
    href: "/mockup",
    label: "Mockup Maker",
    description: "Create device mockups from screenshots",
    icon: MockupMakerIcon,
  },
  {
    href: "/metadata",
    label: "Metadata Remover",
    description: "Remove metadata from images and videos",
    icon: MetadataRemoverIcon,
  },
];

export function Navigation() {
  const segments = useSelectedLayoutSegments();
  const segment = segments[0] || "(code)";
  const showBackButton = segments.includes("shared") ? segments.length > 1 : segments.length > 2;
  const backHref =
    segment === "icon" ? "/icon" : segment === "metadata" ? "/metadata" : segment === "mockup" ? "/mockup" : "/";
  const activeLink =
    links.find((link) => {
      if (link.href === "/") {
        return segment === "(code)";
      }

      return segment === link.href.slice(1);
    }) ?? links[0];

  return (
    <nav className="flex items-center gap-3 h-[50px] pl-4 pr-5 bg-gray-2 text-white w-full fixed z-10">
      <div className="relative flex items-center">
        <Button
          asChild
          className={cn(
            "absolute left-0 rounded-full shadow-none w-6 h-6 shrink-0 bg-gray-4 hover:bg-gray-5 text-gray-12 transition-all",
            showBackButton ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-75",
          )}
        >
          <Link href={backHref} aria-label="Home" aria-disabled={!showBackButton} tabIndex={showBackButton ? 0 : -1}>
            <ChevronLeftIcon className="w-4 h-4 shrink-0" />
          </Link>
        </Button>
        <div className="min-w-0" style={{ paddingLeft: showBackButton ? 36 : 0 }}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="transparent"
                className="h-8 w-max justify-between gap-2 rounded-full border border-gray-a3 bg-gray-a2/60 px-2.5 text-gray-12 shadow-[inset_0_1px_0_hsla(0,0%,100%,0.035)] hover:bg-gray-a3"
                style={{ minWidth: NAVIGATION_WIDTH }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center text-gray-12">
                    <activeLink.icon className="h-6 w-6" />
                  </div>
                  <span className="whitespace-nowrap text-sm font-medium">{activeLink.label}</span>
                </div>
                <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-11" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-max max-w-[calc(100vw-2rem)] rounded-xl p-2">
              <DropdownMenuLabel className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-9">
                Switch Tool
              </DropdownMenuLabel>
              {links.map((link) => {
                const isActive = link.href === "/" ? segment === "(code)" : segment === link.href.slice(1);

                return (
                  <DropdownMenuItem
                    key={link.href}
                    asChild
                    className={cn("rounded-lg px-2 py-2.5 text-gray-12 focus:bg-gray-a2", isActive && "bg-gray-a2")}
                  >
                    <Link href={link.href} aria-current={isActive ? "page" : undefined}>
                      <div className="flex shrink-0 items-center justify-center text-gray-12">
                        <link.icon className="h-9 w-9" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{link.label}</span>
                          {isActive && <CheckIcon className="h-4 w-4 shrink-0 text-gray-11" />}
                        </div>
                        <p className="truncate text-xs text-gray-10">{link.description}</p>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </nav>
  );
}

export function NavigationActions({ children, className }: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <div
      className={cn("h-[50px] flex items-center justify-end fixed top-0 right-scrollbar-offset gap-2 z-10", className)}
      style={{ left: NAVIGATION_ACTIONS_LEFT }}
    >
      {children}
    </div>
  );
}
