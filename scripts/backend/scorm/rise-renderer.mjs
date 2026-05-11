export function renderRiseLessonInBrowser() {
  const normalize = (value) =>
    (value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

  const normalizeMarkdown = (value) =>
    (value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const textToDropSelector = [
    "script",
    "style",
    "noscript",
    "svg",
    "button[data-rmiz-btn-zoom]",
    ".visually-hidden",
    ".visually-hidden-always",
    ".sr-only",
    ".lesson-progress",
    ".continue-btn",
    ".block-text__continue",
    ".block-process-card__start-btn",
    ".carousel-controls",
    ".flashcard-side-flip",
    ".block-list__number",
    ".block-list__bullet",
  ].join(",");

  const stripUiText = (value) =>
    normalize(value).replace(/\s*\(opens in a new tab\)/gi, "");

  const inlineText = (node) => {
    if (!node) {
      return "";
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return stripUiText(node.textContent || "");
    }

    if (node instanceof Element) {
      const clone = node.cloneNode(true);
      clone
        .querySelectorAll(textToDropSelector)
        .forEach((element) => element.remove());
      return stripUiText(clone.innerText || clone.textContent || "");
    }

    return stripUiText(node.textContent || "");
  };

  const isNarrativeHeading = (text) => {
    const words = text.split(/\s+/).filter(Boolean).length;
    const punctuationCount = (text.match(/[,.!?;:]/g) || []).length;
    return (
      (text.length >= 140 && words >= 18 && punctuationCount >= 1) ||
      words >= 32
    );
  };

  const renderHeading = (text) =>
    isNarrativeHeading(text) ? text : `### ${text}`;

  const assetBasename = (src) => {
    const cleanSrc = String(src || "")
      .split(/[?#]/)[0]
      .replace(/\\/g, "/");
    return cleanSrc.split("/").pop() || "";
  };

  const isDecorativeImage = (image) => {
    const className = String(image.className || "");

    if (
      className.includes("block-quote__avatar") &&
      image.closest(".block-quote")
    ) {
      return true;
    }

    const src = image.getAttribute("src") || "";
    const alt = normalize(image.getAttribute("alt") || "");
    if (alt || !/^stock-image\.[a-z0-9]+$/i.test(assetBasename(src))) {
      return false;
    }

    const imageBlock = image.closest(".block-image");
    if (!imageBlock) {
      return false;
    }

    const blockClassName = String(imageBlock.className || "");
    const isDecorativeLayout =
      blockClassName.includes("block-image--overlay") ||
      blockClassName.includes("block-image--hero");
    return isDecorativeLayout && !inlineText(imageBlock);
  };

  const isSkippable = (element) => {
    const className = String(element.className || "");
    const aria = element.getAttribute("aria-label") || "";
    return (
      ["SCRIPT", "STYLE", "NOSCRIPT", "SVG"].includes(element.tagName) ||
      element.matches(textToDropSelector) ||
      className.includes("visually-hidden") ||
      className.includes("visually-hidden-always") ||
      className.includes("sr-only") ||
      className.includes("lesson-progress") ||
      className.includes("continue-btn") ||
      className.includes("block-text__continue") ||
      className.includes("block-process-card__start-btn") ||
      className.includes("carousel-controls") ||
      className.includes("flashcard-side-flip") ||
      className.includes("block-list__number") ||
      className.includes("block-list__bullet") ||
      /^Zoom image$/i.test(aria)
    );
  };

  const directChildrenMarkdown = (element) =>
    [...element.childNodes]
      .map((child) => nodeToMarkdown(child))
      .filter(Boolean)
      .join("\n\n")
      .trim();

  const listItemText = (item) => {
    const nestedLists = [...item.querySelectorAll(":scope > ul, :scope > ol")];
    const clones = item.cloneNode(true);
    clones.querySelectorAll("ul,ol").forEach((list) => list.remove());
    const ownText = directChildrenMarkdown(clones) || normalize(clones.textContent || "");
    const nestedMarkdown = nestedLists
      .map((list) => nodeToMarkdown(list))
      .filter(Boolean)
      .join("\n");
    return nestedMarkdown ? `${ownText}\n${nestedMarkdown}` : ownText;
  };

  const indentMarkdown = (markdown) =>
    markdown
      .split("\n")
      .map((line) => (line ? `  ${line}` : line))
      .join("\n");

  const singleLine = (markdown) =>
    normalize(markdown)
      .replace(/\n+/g, " ")
      .replace(/[ \t]{2,}/g, " ");

  const renderOrderedItem = (marker, markdown) => {
    const [firstLine, ...rest] = markdown.split("\n");
    const continuation = rest.length
      ? `\n${rest.map((line) => (line ? `   ${line}` : line)).join("\n")}`
      : "";
    return `${marker}. ${firstLine}${continuation}`;
  };

  const renderFlashcard = (card) => {
    const front =
      card.querySelector(
        ".flashcard-side--front .flashcard-side__description .fr-view",
      ) ||
      card.querySelector(".flashcard-side--front .flashcard-side__description");
    const back =
      card.querySelector(
        ".flashcard-side--back .flashcard-side__description .fr-view",
      ) ||
      card.querySelector(".flashcard-side--back .flashcard-side__description");

    const title = singleLine(front ? directChildrenMarkdown(front) : "");
    const description = back ? directChildrenMarkdown(back) : "";

    if (!title && !description) {
      return "";
    }

    if (!description) {
      return `- **${title}**`;
    }

    if (!description.includes("\n")) {
      return `- **${title}**: ${singleLine(description)}`;
    }

    return `- **${title}**:\n${indentMarkdown(description)}`;
  };

  const renderFlashcards = (element) =>
    [...element.querySelectorAll(":scope .flashcard")]
      .map((card) => renderFlashcard(card))
      .filter(Boolean)
      .join("\n");

  const renderAccordion = (element) =>
    [...element.querySelectorAll(":scope .blocks-accordion__item")]
      .map((item) => {
        const titleElement =
          item.querySelector(":scope .blocks-accordion__title .fr-view") ||
          item.querySelector(":scope .blocks-accordion__title");
        const descriptionElement =
          item.querySelector(
            ":scope .blocks-accordion__description .fr-view",
          ) || item.querySelector(":scope .blocks-accordion__description");

        const title = singleLine(
          titleElement ? directChildrenMarkdown(titleElement) : "",
        );
        const description = descriptionElement
          ? directChildrenMarkdown(descriptionElement)
          : "";

        return [`### ${title}`, description].filter(Boolean).join("\n\n");
      })
      .filter(Boolean)
      .join("\n\n");

  const renderTabs = (element) => {
    const tabs = [...element.querySelectorAll(":scope [role='tab']")];
    const panels = [...element.querySelectorAll(":scope [role='tabpanel']")];
    const panelById = new Map(
      panels
        .filter((panel) => panel.id)
        .map((panel) => [panel.id, panel]),
    );

    return tabs
      .map((tab, index) => {
        const title = singleLine(inlineText(tab));
        const panel =
          panelById.get(tab.getAttribute("aria-controls") || "") ||
          panels[index];
        const descriptionElement =
          panel?.querySelector(":scope .blocks-tabs__description .fr-view") ||
          panel?.querySelector(":scope .blocks-tabs__description") ||
          panel;
        const description = descriptionElement
          ? directChildrenMarkdown(descriptionElement)
          : "";

        if (!title && !description) {
          return "";
        }

        if (!description) {
          return `- **${title}**`;
        }

        if (!description.includes("\n")) {
          return `- **${title}**: ${singleLine(description)}`;
        }

        return `- **${title}**:\n${indentMarkdown(description)}`;
      })
      .filter(Boolean)
      .join("\n");
  };

  const renderProcess = (element) => {
    const slides = [...element.querySelectorAll(":scope .carousel-slide")];
    if (slides.length === 0) {
      return "";
    }

    let step = 0;
    return slides
      .map((slide) => {
        const card =
          slide.querySelector(":scope .block-process-card") || slide;
        const titleElement =
          card.querySelector(":scope .block-process-card__title .fr-view") ||
          card.querySelector(":scope .block-process-card__title");
        const descriptionElement =
          card.querySelector(
            ":scope .block-process-card__description .fr-view",
          ) || card.querySelector(":scope .block-process-card__description");
        const mediaElement = card.querySelector(
          ":scope .block-process-card__media",
        );
        const title = singleLine(
          titleElement ? directChildrenMarkdown(titleElement) : "",
        );
        const description = descriptionElement
          ? directChildrenMarkdown(descriptionElement)
          : "";
        const media = mediaElement ? directChildrenMarkdown(mediaElement) : "";

        if (card.classList.contains("block-process-card--intro")) {
          return [title ? `### ${title}` : "", description, media]
            .filter(Boolean)
            .join("\n\n");
        }

        const number =
          normalize(
            card.querySelector(":scope .block-process-card__number")
              ?.textContent,
          ) || String((step += 1));
        if (number === String(step + 1)) {
          step += 1;
        }

        const content = [
          title ? `**${title}**` : "",
          description,
          media,
        ]
          .filter(Boolean)
          .join("\n\n");

        return content ? renderOrderedItem(number, content) : "";
      })
      .filter(Boolean)
      .join("\n\n");
  };

  const renderBlockList = (element) => {
    const isNumbered =
      element.classList.contains("block-list--numbered") ||
      element.querySelector(".block-list__item--numbered");
    const items = [...element.querySelectorAll(":scope .block-list__item")];

    return items
      .map((item, index) => {
        const content = item.querySelector(":scope .block-list__content") || item;
        const itemMarkdown =
          directChildrenMarkdown(content) || normalize(content.textContent || "");

        if (!itemMarkdown) {
          return "";
        }

        const marker = isNumbered
          ? `${normalize(
              item.querySelector(":scope .block-list__number")?.textContent ||
                String(index + 1),
            )}.`
          : "-";

        const [firstLine, ...rest] = itemMarkdown.split("\n");
        const continuation = rest.length ? `\n${indentMarkdown(rest.join("\n"))}` : "";
        return `${marker} ${firstLine}${continuation}`;
      })
      .filter(Boolean)
      .join("\n");
  };

  const renderVideo = (element) => {
    const video = element.querySelector("video");
    const source = element.querySelector("source");
    const src = video?.getAttribute("src") || source?.getAttribute("src") || "";
    const captionElement =
      element.querySelector("figcaption .fr-view") ||
      element.querySelector("figcaption");
    const caption = captionElement ? directChildrenMarkdown(captionElement) : "";

    return [src ? `[video](${src})` : "", caption].filter(Boolean).join("\n\n");
  };

  function nodeToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return normalize(node.textContent);
    }

    if (!(node instanceof Element) || isSkippable(node)) {
      return "";
    }

    if (node.querySelector(":scope .continue-btn")) {
      const clone = node.cloneNode(true);
      clone.querySelectorAll(".continue-btn").forEach((button) => {
        button.remove();
      });
      if (!normalize(clone.textContent || "")) {
        return "";
      }
    }

    const tag = node.tagName;
    if (node.classList.contains("blocks-tabs")) {
      return renderTabs(node);
    }

    if (node.classList.contains("blocks-accordion")) {
      return renderAccordion(node);
    }

    if (node.classList.contains("block-process")) {
      return renderProcess(node);
    }

    if (node.classList.contains("block-video")) {
      return renderVideo(node);
    }

    if (node.classList.contains("block-flashcards")) {
      return renderFlashcards(node);
    }

    if (node.classList.contains("flashcard")) {
      return renderFlashcard(node);
    }

    if (node.classList.contains("block-list")) {
      return renderBlockList(node);
    }

    if (/^H[1-6]$/.test(tag)) {
      const text = inlineText(node);
      return text ? renderHeading(text) : "";
    }

    if (tag === "P") {
      return inlineText(node);
    }

    if (tag === "BR") {
      return "\n";
    }

    if (tag === "UL" || tag === "OL") {
      const items = [...node.children].filter((child) => child.tagName === "LI");
      const fallbackItems =
        items.length > 0 ? items : [...node.querySelectorAll(":scope li")];

      return fallbackItems
        .map((item, index) => {
          const prefix = tag === "OL" ? `${index + 1}.` : "-";
          const itemText = listItemText(item);
          const [firstLine, ...rest] = itemText.split("\n");
          const continuation = rest.length
            ? `\n${indentMarkdown(rest.join("\n"))}`
            : "";
          return `${prefix} ${firstLine}${continuation}`.trim();
        })
        .join("\n");
    }

    if (tag === "PRE") {
      const text = normalize(node.textContent);
      return text ? ["", "```", text, "```", ""].join("\n") : "";
    }

    if (tag === "CODE") {
      return inlineText(node);
    }

    if (tag === "BLOCKQUOTE") {
      const text = directChildrenMarkdown(node) || inlineText(node);
      return text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }

    if (tag === "TABLE") {
      const rows = [...node.querySelectorAll("tr")].map((row) =>
        [...row.children].map((cell) => inlineText(cell)),
      );

      if (rows.length === 0) {
        return "";
      }

      const width = Math.max(...rows.map((row) => row.length));
      const pad = (row) => [...row, ...Array(width - row.length).fill("")];
      const [header, ...body] = rows.map(pad);
      return [
        `| ${header.join(" | ")} |`,
        `| ${Array(width).fill("---").join(" | ")} |`,
        ...body.map((row) => `| ${row.join(" | ")} |`),
      ].join("\n");
    }

    if (tag === "IMG") {
      if (isDecorativeImage(node)) {
        return "";
      }

      const alt = normalize(node.getAttribute("alt") || "");
      const src = node.getAttribute("src") || "";
      return alt || src ? `![${alt}](${src})` : "";
    }

    if (tag === "IFRAME" || tag === "VIDEO" || tag === "AUDIO") {
      const src = node.getAttribute("src") || "";
      return src ? `[${tag.toLowerCase()}](${src})` : "";
    }

    if (tag === "BUTTON" || tag === "A") {
      return inlineText(node);
    }

    const childMarkdown = directChildrenMarkdown(node);
    if (childMarkdown) {
      return childMarkdown;
    }

    if ([...node.children].some((child) => isSkippable(child))) {
      return "";
    }

    return inlineText(node);
  }

  const content =
    document.querySelector(".blocks-lesson") ||
    document.querySelector(".page__content") ||
    document.querySelector("main");

  const title = normalize(
    document.querySelector(".lesson-header__title")?.textContent ||
      document.title,
  );

  const markdown = content ? directChildrenMarkdown(content) : "";
  return {
    title,
    hash: location.hash,
    baseUri: document.baseURI,
    url: location.href,
    markdown: normalizeMarkdown(markdown),
    rawText: content?.innerText || "",
    rawHtml: content?.innerHTML || "",
    textLength: normalize(content?.textContent || "").length,
  };
}
