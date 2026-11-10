"use client";

import { useEffect } from "react";

export function AndroidBrowserClass() {
  useEffect(() => {
    const isAndroid = /Android/i.test(navigator.userAgent);
    document.documentElement.classList.toggle("is-android", isAndroid);
  }, []);

  return null;
}
