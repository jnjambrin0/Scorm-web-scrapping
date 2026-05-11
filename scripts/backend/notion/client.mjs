import { configuredNotionParentPageTitle } from "../shared/env.mjs";
import { sanitizeError } from "../shared/text.mjs";
import { logProgress } from "./progress.mjs";

const NOTION_BATCH_SIZE = 100;
const DEFAULT_NOTION_PARENT_PAGE_TITLE = configuredNotionParentPageTitle();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function notionRequest(callback) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await callback();
      await sleep(350);
      return result;
    } catch (error) {
      const status = error?.status || error?.code;
      if (status === 429 && attempt < 4) {
        const retryAfter = Number(error?.headers?.["retry-after"] || 1);
        await sleep(Math.max(1, retryAfter) * 1000);
        continue;
      }

      throw new Error(sanitizeError(error));
    }
  }

  throw new Error("Notion request failed after retries.");
}

function pageTitle(page) {
  for (const property of Object.values(page.properties || {})) {
    if (property?.type === "title") {
      return property.title
        .map((part) => part.plain_text || part.text?.content || "")
        .join("")
        .trim();
    }
  }

  return "";
}

function normalizedTitle(title) {
  return title.trim().toLocaleLowerCase("es");
}

async function searchParentPageByTitle(notion, title) {
  logProgress(`Searching Notion parent page titled "${title}".`);
  const matches = [];
  let cursor;

  do {
    const response = await notionRequest(() =>
      notion.search({
        query: title,
        filter: {
          property: "object",
          value: "page",
        },
        sort: {
          direction: "descending",
          timestamp: "last_edited_time",
        },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    );

    for (const result of response.results || []) {
      const titleText = pageTitle(result);
      if (normalizedTitle(titleText) === normalizedTitle(title)) {
        matches.push({
          id: result.id,
          title: titleText,
          url: result.url,
        });
      }
    }

    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor && matches.length === 0);

  return matches[0] || null;
}

export async function resolveParentPage(notion) {
  const configuredParentId = process.env.NOTION_PARENT_PAGE_ID?.trim();
  if (configuredParentId) {
    logProgress("Resolving Notion parent from NOTION_PARENT_PAGE_ID.");
    const page = await notionRequest(() =>
      notion.pages.retrieve({
        page_id: configuredParentId,
      }),
    );
    const title = pageTitle(page) || null;
    logProgress(`Using Notion parent page "${title || page.id}".`);

    return {
      id: page.id,
      title,
      url: page.url,
      source: "NOTION_PARENT_PAGE_ID",
    };
  }

  const parentPage = await searchParentPageByTitle(
    notion,
    DEFAULT_NOTION_PARENT_PAGE_TITLE,
  );

  if (!parentPage) {
    throw new Error(
      `NOTION_PARENT_PAGE_ID is not set and no accessible Notion page titled "${DEFAULT_NOTION_PARENT_PAGE_TITLE}" was found. Share that page with the integration or set NOTION_PARENT_PAGE_ID explicitly.`,
    );
  }

  logProgress(`Using Notion parent page "${parentPage.title}".`);
  return {
    ...parentPage,
    source: "NOTION_PARENT_PAGE_TITLE",
  };
}

export async function createNotionPage(notion, title, parentPage) {
  logProgress(`Creating Notion page "${title}" under "${parentPage.title || parentPage.id}".`);
  return notionRequest(() =>
    notion.pages.create({
      parent: {
        page_id: parentPage.id,
      },
      properties: {
        title: {
          title: [
            {
              type: "text",
              text: {
                content: title,
              },
            },
          ],
        },
      },
    }),
  );
}

export async function trashNotionPage(notion, pageId) {
  logProgress("Moving validation page to Notion trash.");
  return notionRequest(() =>
    notion.pages.update({
      page_id: pageId,
      in_trash: true,
    }),
  );
}

export async function appendBlocks(notion, blockId, blocks) {
  const batches = Math.ceil(blocks.length / NOTION_BATCH_SIZE);
  logProgress(`Appending ${blocks.length} Notion blocks in ${batches} batches.`);
  for (let index = 0; index < blocks.length; index += NOTION_BATCH_SIZE) {
    const children = blocks.slice(index, index + NOTION_BATCH_SIZE);
    const batchNumber = Math.floor(index / NOTION_BATCH_SIZE) + 1;
    await notionRequest(() =>
      notion.blocks.children.append({
        block_id: blockId,
        position: { type: "end" },
        children,
      }),
    );
    logProgress(
      `Appended block batch ${batchNumber}/${batches} (${children.length} blocks).`,
    );
  }
}
