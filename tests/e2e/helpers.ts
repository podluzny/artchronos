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

/** Выбор значения в reference/select-поле AdminJS (react-select). */
export async function pickSelect(page: Page, label: string, optionText: string) {
  const group = page
    .locator('section, div')
    .filter({ has: page.locator(`label:text-is("${label}")`) })
    .last()
  const input = group.locator('input[role=combobox], input[id^=react-select]').first()
  await input.click()
  await input.fill(optionText.slice(0, 12))
  await page.locator('[class*=option]', { hasText: optionText }).first().click()
}

export async function submitAndWait(page: Page) {
  await page.locator('button[type=submit]').first().click()
  await page.waitForURL(/\/show$|\/resources\/[A-Za-z]+(\?.*)?$/)
}

/** Открывает карточку записи из списка ресурса по тексту в строке. */
export async function openRecord(page: Page, resource: string, text: string) {
  await page.goto(`/admin/resources/${resource}/actions/list`)
  await page.locator('tbody tr td', { hasText: text }).first().click()
  await page.waitForURL(/\/show$/)
}

/** Запускает действие записи по подписи кнопки на карточке. */
export async function recordAction(page: Page, label: string) {
  await page.locator('a, button', { hasText: label }).first().click()
  await page.waitForURL(/\/actions\/|\/records\/.+\/[a-zA-Z]+$/)
}
