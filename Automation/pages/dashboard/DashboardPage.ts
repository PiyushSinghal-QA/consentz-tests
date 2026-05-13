import { type Page, type Locator, expect } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly heading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.locator('main h1').first();
  }

  async goto() {
    // `/` redirects to /admin/clinics/{id}/dashboard. Both legs can be slow
    // on staging; budget 120s each so we don't false-fail on a slow tick.
    await this.page.goto('/', { waitUntil: 'commit', timeout: 120_000 });
    await this.page.waitForURL(/\/admin\/clinics\/\d+\/dashboard/, {
      waitUntil: 'commit',
      timeout: 120_000,
    });
  }

  async assertLoaded() {
    await expect(this.page).toHaveURL(/\/admin\/clinics\/\d+\/dashboard/);
    await expect(this.heading).toContainText('Dashboard');
  }

  getClinicId(): string {
    const m = this.page.url().match(/\/admin\/clinics\/(\d+)\//);
    if (!m) throw new Error(`URL is not clinic-scoped: ${this.page.url()}`);
    return m[1]!;
  }
}
