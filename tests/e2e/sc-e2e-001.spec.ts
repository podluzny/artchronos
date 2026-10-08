import { expect, test } from '@playwright/test'
import {
  activate,
  ADMIN,
  createUserViaUi,
  login,
  logout,
  openRecord,
  pickSelect,
  recordAction,
  submitAndWait,
} from './helpers.js'

/**
 * AT-E2E-001 — SC-E2E-001 (scenarios/scenario-registry.md). Сценарий наращивается по мере готовности блоков:
 * M1: шаги 1–2. M2: шаг 3 (учебная структура и задание через UI).
 */
test.describe.serial('SC-E2E-001 E2E reference scenario', () => {
  const teacher = {
    email: `t1.${Date.now()}@e2e.local`,
    name: 'Преподаватель Т1',
    role: 'TEACHER',
    password: 'Teacher-Password-1',
  }
  const student = {
    email: `s1.${Date.now()}@e2e.local`,
    name: 'Студент С1',
    role: 'STUDENT',
    password: 'Student-Password-1',
  }

  test('шаг 1: Admin входит', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password)
    await expect(page.getByText('Административная система подготовки')).toBeVisible()
  })

  test('шаг 2: Admin создает преподавателя и студента; они активируют учетные записи', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password)
    const tLink = await createUserViaUi(page, teacher)
    const sLink = await createUserViaUi(page, student)
    await page.goto('/admin/resources/User/actions/list')
    await expect(page.getByText(teacher.email)).toBeVisible()
    await expect(page.getByText(student.email)).toBeVisible()
    await logout(page)
    await activate(page, tLink, teacher.password)
    await activate(page, sLink, student.password)
    // аудит: две записи создания пользователей
    await login(page, ADMIN.email, ADMIN.password)
    await page.goto('/admin/resources/AuditLog/actions/list?filters.action=user.created')
    await expect(page.locator('tbody tr')).toHaveCount(2)
  })

  test('шаг 2: студент не видит администрирование и не может открыть пользователей', async ({ page }) => {
    await login(page, student.email, student.password)
    await page.goto('/admin/resources/User/actions/list')
    await expect(page.getByText(teacher.email)).toHaveCount(0)
    await page.goto('/admin/resources/AuditLog/actions/list')
    await expect(page.locator('tbody tr')).toHaveCount(0)
  })

  const stamp = Date.now() % 100000
  const course = `Русское искусство XIX века ${stamp}`
  const assignment = `Тест по пейзажу ${stamp}`

  test('подготовка (Admin): предмет, курс, преподаватель курса', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password)
    await page.goto('/admin/resources/Subject/actions/new')
    await page.fill('#code', `HIST${stamp}`)
    await page.fill('#name', `История искусства ${stamp}`)
    await submitAndWait(page)
    await page.goto('/admin/resources/Course/actions/new')
    await pickSelect(page, 'Предмет', `История искусства ${stamp}`)
    await page.fill('#code', `RU19-${stamp}`)
    await page.fill('#name', course)
    await submitAndWait(page)
    await openRecord(page, 'Course', course)
    await recordAction(page, 'Назначить преподавателей')
    await page.locator(`label:has-text("${teacher.name}")`).click()
    await page.getByRole('button', { name: 'Сохранить преподавателей' }).click()
    await expect(page.getByText(teacher.name).first()).toBeVisible()
  })

  test('шаг 3: Teacher создает тему, группу, задание; настраивает и активирует', async ({ page }) => {
    await login(page, teacher.email, teacher.password)
    await page.goto('/admin/resources/Topic/actions/new')
    await pickSelect(page, 'Курс', course)
    await page.fill('#name', 'Пейзаж')
    await submitAndWait(page)

    await page.goto('/admin/resources/StudentGroup/actions/new')
    await pickSelect(page, 'Курс', course)
    await page.fill('#name', `Г-${stamp}`)
    await submitAndWait(page)
    await openRecord(page, 'StudentGroup', `Г-${stamp}`)
    await recordAction(page, 'Изменить состав')
    await page.locator(`label:has-text("${student.name}")`).click()
    await page.getByRole('button', { name: 'Сохранить состав' }).click()
    await expect(page.getByText(student.name).first()).toBeVisible()

    await page.goto('/admin/resources/Assignment/actions/new')
    await pickSelect(page, 'Курс', course)
    await page.fill('#title', assignment)
    await page.fill('#minItems', '2')
    await page.fill('#maxItems', '5')
    await page.fill('#maxTestsPerStudent', '1')
    const deadline = new Date(Date.now() + 7 * 86400_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const local = `${deadline.getFullYear()}-${pad(deadline.getMonth() + 1)}-${pad(deadline.getDate())} 12:00`
    const dateBox = page.getByText('Дедлайн', { exact: true }).locator('..').getByRole('textbox')
    await dateBox.fill(local)
    await page.keyboard.press('Escape')
    await page.locator('#title').click()
    await submitAndWait(page)
    await openRecord(page, 'Assignment', assignment)
    await recordAction(page, 'Настроить')
    await page.locator('label:has-text("Пейзаж")').first().click()
    await page.locator('label:has-text("Один из нескольких")').click()
    await page.locator('label:has-text("Выбор изображения")').click()
    await page.locator(`label:has-text("Г-${stamp}")`).click()
    await page.getByRole('button', { name: 'Сохранить настройки' }).click()
    await page.waitForURL(/\/show$/)
    await recordAction(page, 'Активировать')
    await page.getByRole('button', { name: 'Активировать' }).click()
    await page.waitForURL(/\/show$/)
    await expect(page.getByText('Активно').first()).toBeVisible()
  })

  test('шаг 3: студент видит активное задание', async ({ page }) => {
    await login(page, student.email, student.password)
    await page.goto('/admin/resources/Assignment/actions/list')
    await expect(page.getByText(assignment)).toBeVisible()
  })
})
