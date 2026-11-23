/** Check the built filters through an authenticated local browser session. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { open } from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.env.VALUX_FILTERS_BASE_URL || "http://127.0.0.1:4180";
const token = process.env.VALUX_FILTERS_SESSION;
assert.ok(token, "Supply a temporary local test session");

const browser = await chromium.launch({
  executablePath: process.env.VALUX_FILTERS_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    try {
      await context.addCookies([{ name: "valux_session", value: token, url: base, httpOnly: true }]);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const query = "?group=valuation&valuationType=general&status=Completed&period=monthly&periodReference=2026-11-01&dateBasis=status";
      const response = await page.goto(base + "/tasks" + query);
      assert.equal(response?.status(), 200);
      assert.equal(new URL(page.url()).pathname, "/tasks");
      const monthly = page.getByRole("button", { name: "Monthly", exact: true });
      const weekly = page.getByRole("button", { name: "Weekly", exact: true });
      const picker = page.locator("#task-period-picker-value");
      await monthly.waitFor({ timeout: 6000 }).catch(async () => {
        const bundle = await page.request.get(base + "/assets/built/assignment-filters.js");
        assert.fail(`Filter controls failed to mount (bundle status ${bundle.status()}). ${errors.join(" | ")}`);
      });
      assert.equal(await monthly.getAttribute("aria-pressed"), "true");
      assert.equal(await picker.inputValue(), "2026-11");
      assert.equal(await page.getByRole("button", { name: "Completed during" }).getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator("#status-filter").inputValue(), "Completed");

      await weekly.focus();
      await page.keyboard.press("Enter");
      assert.equal(await weekly.getAttribute("aria-pressed"), "true");
      assert.equal(await weekly.evaluate(button => button === document.activeElement), true);
      assert.equal(await picker.locator("option").count(), 52);
      const week = await picker.locator("option").nth(1).getAttribute("value");
      await picker.selectOption(week);
      await page.waitForFunction(value => new URLSearchParams(location.search).get("periodReference") === value, week);
      await page.locator("#status-filter").selectOption("Closed");
      const closed = page.getByRole("button", { name: "Closed during", exact: true });
      assert.equal(await closed.getAttribute("aria-pressed"), "true");

      await page.locator("#tasks-dashboard-link").click();
      await page.waitForURL(url => url.pathname === "/");
      await page.goBack();
      await page.waitForURL(url => url.pathname === "/tasks");
      assert.equal(await picker.inputValue(), week);
      assert.equal(await page.locator("#status-filter").inputValue(), "Closed");

      if (width === 1440) {
        const pending = page.waitForEvent("download");
        await page.getByRole("button", { name: "Export to Excel" }).last().click();
        const download = await pending;
        assert.match(download.suggestedFilename(), /^ValuX_.*Closed.*\.xlsx$/);
        const file = await open(await download.path());
        try {
          const header = Buffer.alloc(4);
          await file.read(header, 0, 4, 0);
          assert.deepEqual(header, Buffer.from([80, 75, 3, 4]));
        } finally {
          await file.close();
        }
      }

      await page.getByRole("button", { name: "All time", exact: true }).click();
      await page.locator("#task-period-picker").waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
  console.log("PASS: Vue assignment filters, keyboard focus, 52 weeks, URL and Back navigation, XLSX and mobile");
} finally {
  await browser.close();
}
