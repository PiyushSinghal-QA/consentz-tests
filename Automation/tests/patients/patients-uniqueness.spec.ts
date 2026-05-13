import { test, expect } from '../fixtures';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { PatientsPage } from '../../pages/patients/PatientsPage';
import { DEMO_USER } from '../../test-data/users';

// Uniqueness / conflict flows. Per Piyush, Consentz doesn't HARD-block
// duplicate phones — it surfaces a "duplicate patient" warning and lets
// the user confirm to proceed. The test below verifies the warning is
// not silently bypassed; the "save anyway" branch is a separate concern.

test('duplicate phone surfaces a "duplicate" warning before silently saving the second patient', async ({
  page,
  trackedMarkers,
}) => {
  test.setTimeout(5 * 60 * 1000);

  // The warning could be a Bootstrap modal (DOM text) OR a native JS
  // dialog (page.on('dialog')). Capture either, dismiss the dialog so
  // we don't accidentally accept the duplicate save.
  let dialogMessage: string | null = null;
  page.on('dialog', async (d) => {
    dialogMessage = d.message();
    await d.dismiss();
  });

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  const clinicId = dashboard.getClinicId();

  // Both patients share the same phone — second submit should hit the
  // "duplicate patient" warning UI.
  const tag = Date.now().toString(36);
  const phone = `7${Date.now().toString().slice(-9)}`;
  const marker1 = `ProbeA${tag}`;
  const marker2 = `ProbeB${tag}`;
  trackedMarkers.push(marker1, marker2);

  const patients = new PatientsPage(page);

  // 1. Create the first patient — clean save
  await patients.gotoNew(clinicId);
  await patients.fill({ firstName: marker1, lastName: 'Test', phone });
  await patients.save();

  // 2. Try a second create with the SAME phone. Don't use save() (it
  //    waits for nav to /patients/{id}/edit, which doesn't happen while
  //    a confirm warning is in the way) — click and observe.
  await patients.gotoNew(clinicId);
  await patients.fill({ firstName: marker2, lastName: 'Test', phone });
  await page.waitForTimeout(500);
  await patients.saveButton.click({ noWaitAfter: true });
  await page.waitForTimeout(3_000);

  // 3. Either a JS dialog OR a DOM region must mention "duplicate".
  const dialogHasDup = dialogMessage !== null && /duplicate/i.test(dialogMessage);
  const domHasDup = await page
    .getByText(/duplicate/i)
    .first()
    .isVisible()
    .catch(() => false);

  expect(
    dialogHasDup || domHasDup,
    `Expected a "duplicate" warning when saving a second patient with ` +
      `the same phone. dialogMessage=${dialogMessage}, domHasDup=${domHasDup}`,
  ).toBeTruthy();

  // Cleanup: marker1 was actually saved; marker2 was held back by the
  // confirmation. trackedMarkers covers both as a safety net.
  await patients.gotoList(clinicId);
  await patients.search(marker1);
  if ((await patients.count()) > 0) {
    await patients.openByName(marker1);
    await patients.delete(DEMO_USER.password);
  }
});
