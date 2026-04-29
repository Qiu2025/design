import { useEffect, useState } from "react";

export default function useIsSafari() {
  const [isSafari, setSafari] = useState(false);

  useEffect(() => {
    const isSafari = navigator.userAgent.indexOf("Safari") > -1 && navigator.userAgent.indexOf("Chrome") <= -1;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSafari(isSafari);
  }, []);

  return isSafari;
}
