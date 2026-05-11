export async function scrollWholeLesson(frame) {
  await frame.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let previousHeight = 0;

    for (let pass = 0; pass < 4; pass += 1) {
      const scroller = document.scrollingElement || document.documentElement;
      for (let y = 0; y <= scroller.scrollHeight; y += 650) {
        window.scrollTo(0, y);
        await wait(100);
      }

      if (scroller.scrollHeight === previousHeight) {
        break;
      }
      previousHeight = scroller.scrollHeight;
    }

    window.scrollTo(0, 0);
  });
}

export async function activateNonNavigationControls(frame) {
  await frame.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const isUnsafe = (button) => {
      const className = String(button.className || "");
      const text = (button.innerText || button.textContent || "").trim();
      const aria = button.getAttribute("aria-label") || "";

      return (
        className.includes("continue-btn") ||
        className.includes("lesson-progress") ||
        className.includes("nav-control") ||
        className.includes("nav-sidebar") ||
        className.includes("search") ||
        /complete|search|navigation|menu/i.test(aria) ||
        /^SKIP TO LESSON$/i.test(text)
      );
    };

    const buttons = [...document.querySelectorAll(".blocks-lesson button")].filter(
      (button) => !isUnsafe(button),
    );

    for (const button of buttons) {
      try {
        button.scrollIntoView({ block: "center" });
        await wait(80);
        button.click();
        await wait(140);
      } catch {
        // Best-effort only. The DOM text extractor still reads the underlying
        // lesson markup when a control cannot be activated.
      }
    }
  });
}
