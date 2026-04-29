"use client";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-gray-4 group-[.toaster]:text-white group-[.toaster]:border-brand/50 group-[.toaster]:shadow-[0_0_20px_rgba(255,0,0,0.1)]",
          description: "group-[.toast]:text-gray-11",
          actionButton: "group-[.toast]:bg-brand group-[.toast]:text-white",
          cancelButton: "group-[.toast]:bg-gray-a3 group-[.toast]:text-gray-a11",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
