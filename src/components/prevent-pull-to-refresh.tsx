"use client";

import { useEffect } from "react";

/**
 * Evita que o gesto de puxar para baixo no topo da página acione
 * o pull-to-refresh do navegador. A rolagem normal continua habilitada.
 */
export function PreventPullToRefresh() {
  useEffect(() => {
    let startY = 0;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 1) startY = event.touches[0].clientY;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;

      const currentY = event.touches[0].clientY;
      const movingDown = currentY > startY;
      const pageAtTop =
        window.scrollY <= 0 &&
        document.documentElement.scrollTop <= 0 &&
        document.body.scrollTop <= 0;

      // Cancela somente o gesto descendente iniciado no topo da página.
      if (pageAtTop && movingDown && event.cancelable) {
        event.preventDefault();
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  return null;
}
