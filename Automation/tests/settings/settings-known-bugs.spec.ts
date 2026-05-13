import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';

// Tracked-bug tripwires for Settings.
//
// On v3, Settings/Subscription lives at /admin/settings and /admin/subscription
// (global, NOT clinic-scoped — probed 2026-05-13).
//
// K14 — Settings › Subscription: per-clinic subscription hyperlink routes
//       to Templates instead of subscription detail.
// K15 — Settings › Subscription: default payment-method card has a delete
//       button with no warning, leaving the account without a card.

test.fail('[K14] per-clinic subscription link should route to subscription detail, not Templates', async ({ page }) => {
  test.setTimeout(60_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();

  // Navigate to the Subscription listing
  const resp = await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });
  expect(resp?.status() ?? 0, '/admin/subscription should be reachable').toBeLessThan(400);
  await page.waitForTimeout(2_000);

  // Find a per-clinic subscription link. The bug description references
  // "Teal Swing Sandbox" — match any anchor whose text looks like a
  // clinic name (not an action like "Add" / "Edit" / "Cancel").
  const subscriptionRows = page.locator('main a, table a').filter({
    hasNotText: /^(add|edit|delete|cancel|save|back|export|new|view)$/i,
  });
  const rowCount = await subscriptionRows.count();
  if (rowCount === 0) {
    // Page may not have any clinic-subscription rows visible — that's a
    // separate access problem, not K14. Fail with a clear message.
    throw new Error('No per-clinic subscription rows found on /admin/subscription — cannot probe K14');
  }

  // Click the first such link and observe where it lands
  await subscriptionRows.first().click({ noWaitAfter: true }).catch(() => null);
  await page.waitForTimeout(3_000);

  const landedUrl = page.url();
  console.log(`[K14] clicked per-clinic subscription link → landed at ${landedUrl}`);
  // K14 bug: routes to /templates. Expected post-fix: routes to
  // /subscription/<id> or /subscriptions/<id>.
  expect(landedUrl, 'Per-clinic subscription link should NOT land on /templates').not.toMatch(/\/templates(\b|\/)/i);
});

test.fail('[K15] deleting the default payment card should require explicit confirmation', async ({ page }) => {
  test.setTimeout(60_000);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();

  await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });
  await page.waitForTimeout(2_000);

  // Look for a "default" badge / row near a delete button. The bug is:
  // delete fires immediately without any "are you sure / this is your
  // default card" prompt. Expected post-fix: a confirmation dialog or
  // a disabled delete button on the default card.
  const defaultRow = page.locator(
    ':is([class*="default" i], :has-text("default")):has(button, a)',
  ).first();
  const defaultRowCount = await defaultRow.count();
  if (defaultRowCount === 0) {
    throw new Error('No "default" payment-method row found on /admin/subscription — cannot probe K15');
  }

  // Find the delete control inside that row
  const deleteControl = defaultRow.locator(
    'button:has-text("Delete"), a:has-text("Delete"), [class*="delete" i], [aria-label*="delete" i]',
  ).first();
  await expect(deleteControl, 'Default-card row should have a delete control to probe').toHaveCount(1);

  // Listen for any dialog event — if the delete control triggers an
  // accept/dismiss prompt, the bug is fixed.
  let dialogFired = false;
  page.on('dialog', async (d) => {
    dialogFired = true;
    await d.dismiss();
  });

  await deleteControl.click({ noWaitAfter: true }).catch(() => null);
  await page.waitForTimeout(2_000);

  // Expected post-fix: either a confirm dialog fired OR an in-page
  // confirmation modal is visible.
  const inPageConfirm = await page
    .locator('[role="dialog"], .modal:visible, :has-text(/are you sure|cannot delete the default/i)')
    .count();
  const hasConfirmation = dialogFired || inPageConfirm > 0;
  expect(hasConfirmation, 'Deleting the default card should require explicit confirmation').toBe(true);
});
