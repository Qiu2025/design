import { cn } from "@/utils/cn";
import React, { useEffect, useState } from "react";
import { Language, LANGUAGES } from "../util/languages";

import styles from "./Editor.module.css";
import { highlightedLinesAtom, highlighterAtom, loadingLanguageAtom } from "../store";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { themeDarkModeAtom, themeAtom } from "../store/themes";

type PropTypes = {
  selectedLanguage: Language | null;
  code: string;
};

function formatPlaintext(code: string, highlightedLines: number[]) {
  return code
    .split("\n")
    .map((line, index) => {
      const lineNumber = index + 1;
      const className = highlightedLines.includes(lineNumber) ? "line highlighted-line" : "line";
      const escapedLine = line.replace(/[\u00A0-\u9999<>\&]/g, (character) => `&#${character.charCodeAt(0)};`);
      return `<span class="${className}" data-line="${lineNumber}">${escapedLine}</span>`;
    })
    .join("\n");
}

const HighlightedCode: React.FC<PropTypes> = ({ selectedLanguage, code }) => {
  const [highlightedHtml, setHighlightedHtml] = useState("");
  const highlighter = useAtomValue(highlighterAtom);
  const setIsLoadingLanguage = useSetAtom(loadingLanguageAtom);
  const highlightedLines = useAtomValue(highlightedLinesAtom);
  const darkMode = useAtomValue(themeDarkModeAtom);
  const theme = useAtomValue(themeAtom);
  const themeName = theme.id === "tailwind" ? (darkMode ? "tailwind-dark" : "tailwind-light") : "css-variables";

  useEffect(() => {
    const generateHighlightedHtml = async () => {
      if (selectedLanguage === LANGUAGES.plaintext) {
        return formatPlaintext(code, highlightedLines);
      }

      if (!highlighter || !selectedLanguage) {
        return code.replace(/[\u00A0-\u9999<>\&]/g, (i) => `&#${i.charCodeAt(0)};`);
      }

      const loadedLanguages = highlighter.getLoadedLanguages() || [];
      const hasLoadedLanguage = loadedLanguages.includes(selectedLanguage.name.toLowerCase());

      if (!hasLoadedLanguage && selectedLanguage.src) {
        setIsLoadingLanguage(true);
        await highlighter.loadLanguage(selectedLanguage.src);
        setIsLoadingLanguage(false);
      }

      let lang = selectedLanguage.name.toLowerCase();
      if (lang === "typescript") {
        lang = "tsx";
      }

      return highlighter.codeToHtml(code, {
        lang: lang,
        theme: themeName,
        transformers: [
          {
            line(node, line) {
              node.properties["data-line"] = line;
              if (highlightedLines.includes(line)) this.addClassToHast(node, "highlighted-line");
            },
          },
        ],
      });
    };

    generateHighlightedHtml().then((newHtml) => {
      setHighlightedHtml(newHtml);
    });
  }, [code, selectedLanguage, highlighter, setIsLoadingLanguage, setHighlightedHtml, highlightedLines, themeName]);

  return (
    <div
      className={cn(styles.formatted, selectedLanguage === LANGUAGES.plaintext && styles.plainText)}
      dangerouslySetInnerHTML={{
        __html: highlightedHtml,
      }}
    />
  );
};

export default HighlightedCode;
