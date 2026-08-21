import React, { useEffect } from "react";

const css = `
@media (max-width: 719px) {
  .nm-line-backdrop {
    inset: auto 0 auto 0 !important;
    top: var(--nm-chat-visual-top, 0px) !important;
    bottom: auto !important;
    width: 100% !important;
    height: var(--nm-chat-visual-height, 100dvh) !important;
    min-height: 0 !important;
    align-items: stretch !important;
    padding: 0 !important;
    background: #100D14 !important;
    overflow: hidden !important;
  }

  .nm-line-sheet {
    width: 100% !important;
    height: 100% !important;
    max-height: none !important;
    min-height: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
  }

  .nm-line-room {
    height: 100% !important;
  }

  .nm-line-messages {
    min-height: 0 !important;
    overscroll-behavior: contain !important;
    -webkit-overflow-scrolling: touch;
  }

  /* iOS Safariは16px未満の入力欄をフォーカスすると画面を自動ズームする。 */
  .nm-line-compose textarea {
    font-size: 16px !important;
    line-height: 1.4 !important;
    -webkit-text-size-adjust: 100%;
  }

  .nm-line-compose {
    position: relative !important;
    z-index: 2 !important;
    flex-shrink: 0 !important;
  }
}
`;

export default function ChatViewportFix() {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const viewport = window.visualViewport;
    let locked = false;
    let previousHtmlOverflow = "";
    let previousBodyOverflow = "";
    let previousBodyOverscroll = "";

    const chatIsOpen = () => Boolean(document.querySelector(".nm-line-backdrop"));

    const updateViewport = () => {
      if (!chatIsOpen()) return;
      const height = Math.max(1, Math.round(viewport?.height || window.innerHeight));
      const top = Math.max(0, Math.round(viewport?.offsetTop || 0));
      root.style.setProperty("--nm-chat-visual-height", `${height}px`);
      root.style.setProperty("--nm-chat-visual-top", `${top}px`);
    };

    const lockPage = () => {
      if (locked) return;
      locked = true;
      previousHtmlOverflow = root.style.overflow;
      previousBodyOverflow = body.style.overflow;
      previousBodyOverscroll = body.style.overscrollBehavior;
      root.style.overflow = "hidden";
      body.style.overflow = "hidden";
      body.style.overscrollBehavior = "none";
      updateViewport();
    };

    const unlockPage = () => {
      if (!locked) return;
      locked = false;
      root.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      root.style.removeProperty("--nm-chat-visual-height");
      root.style.removeProperty("--nm-chat-visual-top");
    };

    const sync = () => {
      if (chatIsOpen()) {
        lockPage();
        updateViewport();
      } else {
        unlockPage();
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(body, { childList: true, subtree: true });

    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);

    const onFocusIn = (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (!event.target.closest(".nm-line-compose")) return;
      requestAnimationFrame(updateViewport);
      setTimeout(updateViewport, 80);
      setTimeout(updateViewport, 250);
    };
    document.addEventListener("focusin", onFocusIn);

    sync();

    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      document.removeEventListener("focusin", onFocusIn);
      unlockPage();
    };
  }, []);

  return <style>{css}</style>;
}
