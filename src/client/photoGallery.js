let activeClose = null;

function uniqueUrls(urls) {
  return [...new Set((urls || []).map((url) => String(url || "").trim()).filter(Boolean))];
}

export function openPhotoGallery({ urls, title = "写真" }) {
  const items = uniqueUrls(urls);
  if (!items.length) return () => {};

  activeClose?.();

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  const backdrop = document.createElement("div");
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", `${title}の写真ギャラリー`);
  Object.assign(backdrop.style, {
    position: "fixed",
    inset: "0",
    zIndex: "650",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "18px",
    boxSizing: "border-box",
    background: "rgba(4,3,6,.92)",
  });

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    width: "min(100%, 620px)",
    maxHeight: "94%",
    display: "grid",
    gap: "10px",
    color: "#F4EEF6",
  });

  const top = document.createElement("div");
  Object.assign(top.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  });

  const heading = document.createElement("div");
  heading.textContent = title;
  Object.assign(heading.style, {
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "17px",
    fontWeight: "800",
  });

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "閉じる";
  Object.assign(closeButton.style, {
    minWidth: "56px",
    minHeight: "44px",
    border: "1px solid #493E53",
    borderRadius: "999px",
    background: "#1B1620",
    color: "#F4EEF6",
    fontSize: "13px",
  });

  top.append(heading, closeButton);

  const frame = document.createElement("div");
  Object.assign(frame.style, {
    position: "relative",
    overflow: "hidden",
    borderRadius: "22px",
    border: "1px solid #372E40",
    background: "#100D14",
  });

  const viewport = document.createElement("div");
  Object.assign(viewport.style, {
    display: "flex",
    width: "100%",
    overflowX: "auto",
    scrollSnapType: "x mandatory",
    WebkitOverflowScrolling: "touch",
    scrollbarWidth: "none",
  });
  viewport.style.msOverflowStyle = "none";

  items.forEach((url, index) => {
    const slide = document.createElement("div");
    Object.assign(slide.style, {
      flex: "0 0 100%",
      minWidth: "0",
      scrollSnapAlign: "center",
      display: "grid",
      placeItems: "center",
      background: "#100D14",
    });

    const image = document.createElement("img");
    image.src = url;
    image.alt = `${title} 写真 ${index + 1}`;
    Object.assign(image.style, {
      width: "100%",
      maxHeight: "76vh",
      aspectRatio: "3 / 4",
      objectFit: "contain",
      display: "block",
      background: "#100D14",
    });
    slide.appendChild(image);
    viewport.appendChild(slide);
  });

  const makeArrow = (label, text) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.textContent = text;
    Object.assign(button.style, {
      position: "absolute",
      top: "50%",
      transform: "translateY(-50%)",
      width: "46px",
      height: "46px",
      border: "1px solid rgba(255,255,255,.25)",
      borderRadius: "50%",
      background: "rgba(8,6,10,.68)",
      color: "#fff",
      fontSize: "27px",
      display: items.length > 1 ? "grid" : "none",
      placeItems: "center",
      zIndex: "2",
    });
    return button;
  };

  const prev = makeArrow("前の写真", "‹");
  const next = makeArrow("次の写真", "›");
  prev.style.left = "10px";
  next.style.right = "10px";

  frame.append(viewport, prev, next);

  const footer = document.createElement("div");
  Object.assign(footer.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    minHeight: "28px",
  });

  const dots = document.createElement("div");
  Object.assign(dots.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "7px",
    flexWrap: "wrap",
  });
  const dotNodes = items.map((_, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.setAttribute("aria-label", `${index + 1}枚目を表示`);
    Object.assign(dot.style, {
      width: "8px",
      height: "8px",
      minWidth: "8px",
      padding: "0",
      border: "0",
      borderRadius: "50%",
      background: index === 0 ? "#E2B968" : "#5B5063",
    });
    dots.appendChild(dot);
    return dot;
  });

  const counter = document.createElement("span");
  counter.textContent = `1 / ${items.length}`;
  Object.assign(counter.style, {
    color: "#A99CB0",
    fontSize: "12px",
    minWidth: "44px",
    textAlign: "center",
  });

  footer.append(dots, counter);
  panel.append(top, frame, footer);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  let index = 0;
  let scrollTimer = null;

  const update = (nextIndex) => {
    index = Math.max(0, Math.min(items.length - 1, nextIndex));
    counter.textContent = `${index + 1} / ${items.length}`;
    dotNodes.forEach((dot, i) => {
      dot.style.background = i === index ? "#E2B968" : "#5B5063";
    });
    prev.style.opacity = index <= 0 ? ".35" : "1";
    next.style.opacity = index >= items.length - 1 ? ".35" : "1";
  };

  const go = (nextIndex) => {
    const clamped = Math.max(0, Math.min(items.length - 1, nextIndex));
    viewport.scrollTo({ left: clamped * viewport.clientWidth, behavior: "smooth" });
    update(clamped);
  };

  const onScroll = () => {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const width = viewport.clientWidth || 1;
      update(Math.round(viewport.scrollLeft / width));
    }, 50);
  };

  const onKey = (event) => {
    if (event.key === "Escape") close();
    if (event.key === "ArrowLeft") go(index - 1);
    if (event.key === "ArrowRight") go(index + 1);
  };

  const close = () => {
    if (!backdrop.isConnected) return;
    if (scrollTimer) clearTimeout(scrollTimer);
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = previousOverflow;
    backdrop.remove();
    if (activeClose === close) activeClose = null;
  };

  viewport.addEventListener("scroll", onScroll, { passive: true });
  prev.addEventListener("click", () => go(index - 1));
  next.addEventListener("click", () => go(index + 1));
  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  dotNodes.forEach((dot, dotIndex) => dot.addEventListener("click", () => go(dotIndex)));
  document.addEventListener("keydown", onKey);

  update(0);
  activeClose = close;
  return close;
}
