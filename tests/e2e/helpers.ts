import { expect, type Page } from '@playwright/test'

export const ADMIN = { email: 'admin@e2e.local', password: 'E2E-Admin-Password-1' }

export async function login(page: Page, email: string, password: string) {
  await page.goto('/admin/login')
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', password)
  await page.click('button')
  await page.waitForURL(/\/(admin|account\/password)/)
}

export async function logout(page: Page) {
  await page.goto('/admin/logout')
  await expect(page).toHaveURL(/\/admin\/login/)
}

/** Создает пользователя через UI и возвращает одноразовую ссылку активации. */
export async function createUserViaUi(page: Page, u: { email: string; name: string; role: string }) {
  await page.goto('/admin/resources/User/actions/new')
  await page.fill('#email', u.email)
  await page.fill('#displayName', u.name)
  await page.locator(`label:has-text("(${u.role})")`).click()
  await page.getByRole('button', { name: 'Создать пользователя' }).click()
  const link = page.locator('input[readonly]')
  await expect(link).toHaveValue(/\/account\/activate\?token=/)
  return link.inputValue()
}

/** Активирует учетную запись по ссылке, задавая пароль. */
export async function activate(page: Page, link: string, password: string) {
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ''))
  await page.fill('#newPassword', password)
  await page.fill('#confirm', password)
  await page.click('button[type=submit]')
  await expect(page.getByText('Пароль сохранен')).toBeVisible()
}
