import { useEffect, useState } from "react";

let deferred = null;
const listeners = new Set();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  const install = async () => {
    if (!deferred) return false;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    force((n) => n + 1);
    return true;
  };
  return { canInstall: !!deferred && !isStandalone(), iosHint: isIOS() && !isStandalone(), installed: isStandalone(), install };
}
