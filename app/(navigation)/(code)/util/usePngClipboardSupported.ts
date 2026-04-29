import { useEffect, useState } from "react";

export default function usePngClipboardSupported() {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(window.navigator && window.navigator.clipboard && typeof ClipboardItem === "function");
  }, []);

  return supported;
}
