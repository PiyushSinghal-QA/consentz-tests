import { type Page, type Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly username: Locator;
  readonly password: Locator;
  readonly submit: Locator;

  constructor(page: Page) {
    this.page = page;
    // Form uses a floating-label pattern — the visible "Username"/"Password"
    // is a <label>, not a placeholder attribute. Anchor by input type
    // within the form scope instead.
    const form = page.locator('form');
    this.username = form.locator('input').first();
    this.password = form.locator('input[type="password"]');
    this.submit = form.getByRole('button', { name: /sign\s*in/i });
  }

  async goto() {
    await this.page.goto('/admin/login', { waitUntil: 'commit' });
    await this.username.waitFor({ state: 'visible' });
  }

  async login(username: string, password: string) {
    await this.username.fill(username);
    await this.password.fill(password);
    await this.submit.click({ noWaitAfter: true });
    await this.page.waitForURL(/\/admin\/clinics\/\d+\/dashboard/, {
      waitUntil: 'commit',
      timeout: 60_000,
    });
  }

  async assertOnLoginPage() {
    await expect(this.username).toBeVisible();
    await expect(this.password).toBeVisible();
  }
}
