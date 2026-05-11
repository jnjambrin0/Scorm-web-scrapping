export async function readScormPageTitle(frame) {
  try {
    return await frame.evaluate(() => {
      const clean = (value) =>
        (value || "")
          .replace(/\u00a0/g, " ")
          .replace(/[ \t\r\n]+/g, " ")
          .trim();

      const selectors = [
        ".overview__title",
        ".cover__title",
        ".course-title",
        "[class*='title'] h1",
        "h1",
      ];
      for (const selector of selectors) {
        const value = clean(document.querySelector(selector)?.textContent);
        if (value && value.length > 3) {
          return value;
        }
      }

      const documentTitle = clean(document.title);
      return documentTitle && !/^rise$/i.test(documentTitle) ? documentTitle : "";
    });
  } catch {
    return "";
  }
}

function readOverviewFromDom() {
  const clean = (value) =>
    (value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\r\n]+/g, " ")
      .trim();

  const overviewItems = [
    ...document.querySelectorAll(
      ".overview-list__section-title, a.overview-list-item__link",
    ),
  ];
  const sections = [];

  for (const item of overviewItems) {
    if (item.matches(".overview-list__section-title")) {
      sections.push({
        title: clean(item.innerText || item.textContent),
        lessons: [],
      });
    } else if (sections.length > 0) {
      sections.at(-1).lessons.push({
        title: clean(item.innerText || item.textContent),
        href: item.getAttribute("href"),
      });
    }
  }

  return sections.filter(
    (section) => section.title && section.lessons.length > 0,
  );
}

export async function readOverview(frame) {
  await frame.evaluate(() => {
    location.hash = "#/preview";
  });
  await frame.page().waitForTimeout(2500);

  let overview = await frame.evaluate(readOverviewFromDom);
  if (overview.length > 0) {
    return overview;
  }

  await frame.evaluate(() => {
    location.hash = "#/";
  });
  await frame.page().waitForTimeout(2500);

  overview = await frame.evaluate(readOverviewFromDom);
  return overview;
}
