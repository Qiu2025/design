"use client";

import { WandIcon } from "@raycast/icons";
import formatCode, { formatterSupportedLanguages } from "../util/formatCode";
import { useAtom } from "jotai";
import { codeAtom, selectedLanguageAtom } from "../store/code";
import useHotkeys from "@/utils/useHotkeys";
import { Button } from "@/components/button";
import { toast } from "@/components/toast";
import { cn } from "@/utils/cn";
import { useEffect, useState } from "react";

const formatToastClassName =
  "!left-1/2 !w-fit !max-w-[calc(100vw-2rem)] !-translate-x-1/2 !border-gray-a5 !px-3.5 !py-3 !shadow-[0_8px_30px_rgba(0,0,0,0.35)] max-sm:!top-[54px] max-sm:!left-[calc(50%-16px)]";

const FormatButton: React.FC = () => {
  const [selectedLanguage, setSelectedLanguage] = useAtom(selectedLanguageAtom);
  const [code, setCode] = useAtom(codeAtom);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsClient(true);
  }, []);

  const handleFormatCode = () => {
    const isSupportedLanguage = formatterSupportedLanguages.includes(selectedLanguage?.name || "");
    if (!isSupportedLanguage) {
      return toast.error("Formatting is not supported for this language");
    }
    if (!code || !selectedLanguage) {
      return;
    }
    const language = selectedLanguage;
    toast.promise(
      formatCode(code, language).then((formatted) => {
        setCode(formatted);
        // Sometimes hljs thinks the formatted code is a different language
        // than the original, so we enforce the original language here
        setSelectedLanguage(language);
      }),
      {
        className: formatToastClassName,
        loading: "Formatting code...",
        success: "Formatted code!",
        error: (error) => {
          const errorMessage =
            error instanceof Error ? error.message.split("\n", 1)[0] : "Check the selected language and syntax.";
          return {
            message: "Code formatting failed",
            description: errorMessage,
            className: formatToastClassName,
          };
        },
      },
    );
  };

  useHotkeys("ctrl+f,cmd+f", (event) => {
    event.preventDefault();
    handleFormatCode();
  });

  if (!isClient) {
    return null;
  }

  return (
    <Button
      onClick={handleFormatCode}
      variant="transparent"
      aria-label="Format code"
      className={cn(
        "hidden",
        selectedLanguage && formatterSupportedLanguages.includes(selectedLanguage.name) && "inline-flex",
      )}
    >
      <WandIcon width={16} height={16} />
      <span className="hidden md:inline">Format Code</span>
    </Button>
  );
};

export default FormatButton;
