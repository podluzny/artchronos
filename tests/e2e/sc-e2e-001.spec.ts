import { expect, test } from '@playwright/test'
import { activate, ADMIN, createUserViaUi, login, logout } from './helpers.js'

/**
 * AT-E2E-001 — SC-E2E-001 (scenarios/scenario-registry.md). Сценарий наращивается по мере готовности блоков:
 * M1: шаги 1–2.
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
})
