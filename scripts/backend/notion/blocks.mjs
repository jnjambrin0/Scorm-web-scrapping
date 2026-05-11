import path from "node:path";

import { configuredNotionMediaWidthRatio } from "../shared/env.mjs";

const RICH_TEXT_LIMIT = 2000;
// Width ratio applied to embedded media in Notion. Resolved at module load
// from `NOTION_MEDIA_WIDTH_RATIO` (defaults to 0.85, clamped 0.5–1.0). The
// web UI surfaces this as a slider in the Settings panel and forwards the
// value as a per-job env override.
export const NOTION_MEDIA_WIDTH_RATIO = configuredNotionMediaWidthRatio();

function plainTextObject(content, annotations = {}, link = null) {
  return {
    type: "text",
    text: {
      content,
      link: link ? { url: link } : null,
    },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default",
      ...annotations,
    },
  };
}

function pushRichText(target, content, annotations = {}, link = null) {
  if (!content) {
    return;
  }

  for (let index = 0; index < content.length; index += RICH_TEXT_LIMIT) {
    target.push(
      plainTextObject(
        content.slice(index, index + RICH_TEXT_LIMIT),
        annotations,
        link,
      ),
    );
  }
}

function richTextFromMarkdown(markdown) {
  const richText = [];
  let index = 0;

  while (index < markdown.length) {
    if (markdown.startsWith("**", index)) {
      const end = markdown.indexOf("**", index + 2);
      if (end > index + 2) {
        pushRichText(richText, markdown.slice(index + 2, end), { bold: true });
        index = end + 2;
        continue;
      }
    }

    if (markdown[index] === "`") {
      const end = markdown.indexOf("`", index + 1);
      if (end > index + 1) {
        pushRichText(richText, markdown.slice(index + 1, end), { code: true });
        index = end + 1;
        continue;
      }
    }

    if (markdown[index] === "[") {
      const linkMatch = markdown.slice(index).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        pushRichText(richText, linkMatch[1], {}, linkMatch[2]);
        index += linkMatch[0].length;
        continue;
      }
    }

    const nextTokens = [
      markdown.indexOf("**", index + 1),
      markdown.indexOf("`", index + 1),
      markdown.indexOf("[", index + 1),
    ].filter((position) => position > -1);
    const next = nextTokens.length ? Math.min(...nextTokens) : markdown.length;
    pushRichText(richText, markdown.slice(index, next));
    index = next;
  }

  return richText;
}

function textBlock(type, text) {
  return {
    type,
    [type]: {
      rich_text: richTextFromMarkdown(text),
      color: "default",
    },
  };
}

function isSupportedVideo(asset) {
  const source = asset?.source?.split("?")[0].toLowerCase() || "";
  return /\.(amv|asf|avi|f4v|flv|gifv|mkv|mov|mpg|mpeg|mpv|mp4|m4v|qt|wmv)$/.test(
    source,
  );
}

function missingAssetBlock(kind, source) {
  const name = path.posix.basename(source.split("?")[0]) || kind;
  return textBlock("paragraph", `[Missing ${kind}: ${name}]`);
}

function directMediaBlock(kind, source, caption, assetsBySource) {
  const asset = assetsBySource.get(source);
  if (!asset || asset.status !== "downloaded" || !asset.fileUploadId) {
    return missingAssetBlock(kind, source);
  }

  const blockType =
    kind === "video" ? (isSupportedVideo(asset) ? "video" : "file") : kind;
  const normalizedType = blockType === "image" ? "image" : blockType;

  if (normalizedType === "video") {
    return {
      type: "video",
      video: {
        type: "file_upload",
        file_upload: { id: asset.fileUploadId },
        caption: caption ? richTextFromMarkdown(caption) : [],
      },
    };
  }

  if (normalizedType === "image") {
    return {
      type: "image",
      image: {
        type: "file_upload",
        file_upload: { id: asset.fileUploadId },
        caption: caption ? richTextFromMarkdown(caption) : [],
      },
    };
  }

  return {
    type: "file",
    file: {
      type: "file_upload",
      file_upload: { id: asset.fileUploadId },
      caption: caption ? richTextFromMarkdown(caption) : [],
    },
  };
}

function pendingMediaBlock(kind, source) {
  const name = path.posix.basename(source.split("?")[0]) || kind;
  return textBlock("paragraph", `[${kind}: ${name}]`);
}

function emptyParagraphBlock() {
  return textBlock("paragraph", "");
}

function roundedRatio(value) {
  return Number(value.toFixed(4));
}

function centeredMediaBlock(block) {
  if (NOTION_MEDIA_WIDTH_RATIO >= 1) {
    return block;
  }

  const centerRatio = roundedRatio(NOTION_MEDIA_WIDTH_RATIO);
  const leftRatio = roundedRatio((1 - centerRatio) / 2);
  const rightRatio = roundedRatio(1 - centerRatio - leftRatio);

  return {
    type: "column_list",
    column_list: {
      children: [
        {
          type: "column",
          column: {
            width_ratio: leftRatio,
            children: [emptyParagraphBlock()],
          },
        },
        {
          type: "column",
          column: {
            width_ratio: centerRatio,
            children: [block],
          },
        },
        {
          type: "column",
          column: {
            width_ratio: rightRatio,
            children: [emptyParagraphBlock()],
          },
        },
      ],
    },
  };
}

function mediaBlock(kind, source, caption, assetsBySource, options = {}) {
  const block = options.dryRun
    ? pendingMediaBlock(kind, source)
    : directMediaBlock(kind, source, caption, assetsBySource);

  return options.center ? centeredMediaBlock(block) : block;
}

function mediaLine(line) {
  const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (image) {
    return {
      kind: "image",
      caption: image[1].trim(),
      source: image[2].trim(),
    };
  }

  const video = line.match(/^\[video\]\(([^)]+)\)$/);
  if (video) {
    return {
      kind: "video",
      caption: "",
      source: video[1].trim(),
    };
  }

  return null;
}

function tableBlock(lines) {
  const rows = lines
    .filter((line, index) => index !== 1)
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
  const width = Math.max(...rows.map((row) => row.length));

  return {
    type: "table",
    table: {
      table_width: width,
      has_column_header: true,
      has_row_header: false,
      children: rows.map((row) => ({
        type: "table_row",
        table_row: {
          cells: [...row, ...Array(width - row.length).fill("")].map((cell) =>
            richTextFromMarkdown(cell),
          ),
        },
      })),
    },
  };
}

function isTableStart(lines, index) {
  return (
    lines[index]?.startsWith("|") &&
    /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[index + 1] || "")
  );
}

function isListLine(line) {
  return /^(\s*)([-*]|\d+\.)\s+(.+)$/.test(line);
}

function isIndented(line) {
  return /^( {2,}|\t)/.test(line);
}

function hasMediaLine(markdown) {
  return markdown
    .split("\n")
    .some((line) => Boolean(mediaLine(line.trim())));
}

function listBlock(kind, itemMarkdown, assetsBySource, dryRun) {
  const lines = itemMarkdown.split("\n");
  let firstLine = (lines.shift() || "").trim();
  let childMarkdown = lines.join("\n").trim();
  const firstMedia = mediaLine(firstLine);
  if (firstMedia) {
    childMarkdown = [firstLine, childMarkdown].filter(Boolean).join("\n\n");
    firstLine = "";
  }

  const type = kind === "numbered" ? "numbered_list_item" : "bulleted_list_item";
  const children = childMarkdown
    ? markdownToNotionBlocks(childMarkdown, assetsBySource, {
        dryRun,
        centerMedia: false,
        skipPageTitle: true,
      })
    : [];

  return {
    type,
    [type]: {
      rich_text: firstLine ? richTextFromMarkdown(firstLine) : [],
      color: "default",
      ...(children.length ? { children } : {}),
    },
  };
}

function visualListItemBlocks(marker, itemMarkdown, assetsBySource, dryRun) {
  const lines = itemMarkdown.split("\n");
  const firstLine = (lines.shift() || "").trim();
  const childMarkdown = lines.join("\n").trim();
  const blocks = [];
  const firstMedia = mediaLine(firstLine);

  if (firstMedia) {
    blocks.push(textBlock("paragraph", marker));
    blocks.push(
      mediaBlock(
        firstMedia.kind,
        firstMedia.source,
        firstMedia.caption,
        assetsBySource,
        { dryRun, center: true },
      ),
    );
  } else if (firstLine) {
    blocks.push(textBlock("paragraph", `${marker} ${firstLine}`));
  }

  if (childMarkdown) {
    blocks.push(
      ...markdownToNotionBlocks(childMarkdown, assetsBySource, {
        dryRun,
        centerMedia: true,
        skipPageTitle: true,
      }),
    );
  }

  return blocks;
}

function parseList(lines, startIndex, assetsBySource, dryRun) {
  const firstMatch = lines[startIndex].match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
  const kind = firstMatch[2].endsWith(".") ? "numbered" : "bulleted";
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const match = lines[index].match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
    if (!match || Boolean(match[1])) {
      break;
    }

    const continuation = [match[3]];
    index += 1;

    while (index < lines.length) {
      const line = lines[index];
      const nextLine = lines[index + 1] || "";
      if (!line.trim()) {
        if (isListLine(nextLine) && !isIndented(nextLine)) {
          index += 1;
          break;
        }
        if (isIndented(nextLine)) {
          continuation.push("");
          index += 1;
          continue;
        }
        break;
      }

      if (isListLine(line) && !isIndented(line)) {
        break;
      }

      if (isIndented(line)) {
        continuation.push(line.replace(/^( {2,}|\t)/, ""));
        index += 1;
        continue;
      }

      break;
    }

    items.push({
      marker: match[2],
      markdown: continuation.join("\n").trim(),
    });

    if (!lines[index]?.trim() && !isListLine(lines[index + 1] || "")) {
      break;
    }
  }

  const containsMedia = items.some((item) => hasMediaLine(item.markdown));
  const blocks = containsMedia
    ? items.flatMap((item) =>
        visualListItemBlocks(item.marker, item.markdown, assetsBySource, dryRun),
      )
    : items.map((item) =>
        listBlock(kind, item.markdown, assetsBySource, dryRun),
      );

  return { blocks, nextIndex: index };
}

export function markdownToNotionBlocks(markdown, assetsBySource, options = {}) {
  const {
    dryRun = false,
    pageTitle = "",
    skipPageTitle = false,
    centerMedia = true,
  } = options;
  const lines = markdown.replace(/\r/g, "").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (!skipPageTitle && index === 0 && trimmed === `# ${pageTitle}`) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim() || "plain text";
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({
        type: "code",
        code: {
          rich_text: richTextFromMarkdown(codeLines.join("\n")),
          language,
        },
      });
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines = [];
      while (index < lines.length && lines[index].startsWith("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      blocks.push(tableBlock(tableLines));
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(textBlock("quote", quoteLines.join("\n")));
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      blocks.push(textBlock(`heading_${level}`, heading[2].trim()));
      index += 1;
      continue;
    }

    const media = mediaLine(trimmed);
    if (media) {
      blocks.push(
        mediaBlock(
          media.kind,
          media.source,
          media.caption,
          assetsBySource,
          { dryRun, center: centerMedia },
        ),
      );
      index += 1;
      continue;
    }

    if (isListLine(line) && !isIndented(line)) {
      const parsed = parseList(lines, index, assetsBySource, dryRun);
      blocks.push(...parsed.blocks);
      index = parsed.nextIndex;
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trim().startsWith("```") &&
      !isTableStart(lines, index) &&
      !lines[index].trim().startsWith(">") &&
      !/^(#{1,4})\s+/.test(lines[index].trim()) &&
      !mediaLine(lines[index].trim()) &&
      !(isListLine(lines[index]) && !isIndented(lines[index]))
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push(textBlock("paragraph", paragraphLines.join("\n")));
  }

  return blocks.filter(Boolean);
}

export function countBlocksByType(blocks, type) {
  let count = 0;
  const visit = (block) => {
    if (!block?.type) {
      return;
    }

    if (block.type === type) {
      count += 1;
    }

    const children = block[block.type]?.children;
    if (Array.isArray(children)) {
      children.forEach(visit);
    }
  };

  blocks.forEach(visit);
  return count;
}
