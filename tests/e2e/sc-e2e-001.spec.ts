import { expect, test } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
 * M1: шаги 1–2. M2: шаг 3 (учебная структура и задание через UI). M3: шаги 4–6 (вопросы студента).
 * M4: шаги 7–9 (тест студента, отправка, неизменяемость). Создание Review (шаг 8) — M5.
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
    await page.waitForURL(/\/show$/)
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
    await page.waitForURL(/\/show$/)
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

  test('шаг 4: студент создает вопрос single_choice в редакторе', async ({ page }) => {
    await login(page, student.email, student.password)
    await page.goto('/admin/resources/Item/actions/new')
    await pickSelect(page, 'Задание', assignment)
    await page.locator('[data-type=single_choice]').click()
    await page.fill('#stem', 'Кто автор картины «Грачи прилетели»?')
    const texts = page.locator('input[placeholder="Текст"]')
    await texts.nth(0).fill('А. К. Саврасов')
    await texts.nth(1).fill('И. И. Шишкин')
    await texts.nth(2).fill('И. И. Левитан')
    await page.locator('input[aria-label="Вариант 1 верный"]').check()
    await page.getByLabel('Пейзаж', { exact: true }).check({ force: true })
    await page.getByRole('button', { name: 'Создать вопрос' }).click()
    await page.waitForURL(/\/show$/)
    await expect(page.getByText('Ошибок нет — вопрос готов к экспертизе')).toBeVisible()
    await expect(page.getByText('Черновик').first()).toBeVisible()
    // предпросмотр и проверка ответа
    await recordAction(page, 'Предпросмотр')
    await page.locator('label', { hasText: 'А. К. Саврасов' }).click()
    await page.getByRole('button', { name: 'Проверить ответ' }).click()
    await expect(page.getByTestId('preview-result')).toContainText('Баллы: 1 из 1')
  })

  test('шаг 5: студент загружает изображения и создает вопрос image_choice', async ({ page }) => {
    await login(page, student.email, student.password)
    const sharp = (await import('sharp')).default
    const files: string[] = []
    for (const [i, color] of ['#7a5230', '#30507a'].entries()) {
      // путь без кириллицы: Chromium не принимает файлы из outputPath с кириллицей в имени каталога
      const f = join(tmpdir(), `art-${stamp}-${i}.png`)
      await sharp({ create: { width: 200, height: 150, channels: 3, background: color } })
        .png()
        .toFile(f)
      files.push(f)
      await page.goto('/admin/resources/MediaAsset/actions/new')
      await page.locator('#title').waitFor()
      await page.setInputFiles('input[type=file]', f)
      await expect(page.getByText(`art-${stamp}-${i}.png`)).toBeVisible()
      await page.fill('#title', i === 0 ? `Куинджи ${stamp}` : `Шишкин ${stamp}`)
      await page.fill('#altText', i === 0 ? 'Лунная ночь на Днепре' : 'Утро в сосновом лесу')
      await page.fill('#sourceUrl', 'https://commons.wikimedia.org/')
      await pickSelect(page, 'Лицензия', 'Общественное достояние')
      await page.locator('button[type=submit]').click()
      await page.waitForURL(/\/show$/)
    }
    await page.goto('/admin/resources/Item/actions/new')
    await pickSelect(page, 'Задание', assignment)
    await page.locator('[data-type=image_choice]').click()
    await page.fill('#stem', 'Какая из работ принадлежит А. И. Куинджи?')
    for (const [i, title] of [`Куинджи ${stamp}`, `Шишкин ${stamp}`].entries()) {
      await page.getByRole('button', { name: 'Выбрать изображение' }).nth(0).click()
      await page.locator('button', { hasText: title }).click()
      expect(i).toBeGreaterThanOrEqual(0)
    }
    // третий вариант шаблона удаляем
    await page.locator('button[title="Удалить"]').nth(2).click()
    await page.locator('input[aria-label="Вариант 1 верный"]').check()
    await page.getByLabel('Пейзаж', { exact: true }).check({ force: true })
    await page.getByRole('button', { name: 'Создать вопрос' }).click()
    await page.waitForURL(/\/show$/)
    // права на изображения еще не подтверждены — вопрос сохранен, но не готов (BR-024)
    await expect(page.getByText(/BR-024/).first()).toBeVisible()
  })

  test('шаг 6: прямой запрос на создание вопроса неразрешенного типа отклоняется (BR-018)', async ({ page }) => {
    await login(page, student.email, student.password)
    const types = await page.request.post('/admin/api/resources/Item/actions/new', {
      headers: { Origin: 'http://localhost:3300' },
      data: { op: 'context' },
    })
    expect(types.ok()).toBe(true)
    const assignmentsCtx = await types.json()
    const a = assignmentsCtx.assignments.find((x: { label: string }) => x.label.startsWith(assignment))
    const ctxRes = await (
      await page.request.post('/admin/api/resources/Item/actions/new', {
        headers: { Origin: 'http://localhost:3300' },
        data: { op: 'context', assignmentId: a.value },
      })
    ).json()
    expect(ctxRes.types.map((t: { code: string }) => t.code).sort()).toEqual(['image_choice', 'single_choice'])
    const all = await (await page.request.get('/admin/api/resources/QuestionType/actions/list?perPage=50')).json()
    const matching = all.records.find((r: { params: { code: string } }) => r.params.code === 'matching')
    const res = await page.request.post('/admin/api/resources/Item/actions/new', {
      headers: { Origin: 'http://localhost:3300' },
      data: { op: 'create', assignmentId: a.value, questionTypeId: matching.id },
    })
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.message).toMatch(/BR-018/)
  })

  test('шаг 7: студент создает тест из задания, добавляет оба вопроса и задает настройки', async ({ page }) => {
    await login(page, student.email, student.password)
    await page.goto('/admin/resources/Test/actions/new')
    await pickSelect(page, 'Задание или курс', assignment)
    await page.fill('#title', `Пейзаж XIX века ${stamp}`)
    await page.getByRole('button', { name: 'Создать тест' }).click()
    await page.waitForURL(/\/builder$/)
    await expect(page.getByTestId('candidate')).toHaveCount(2)
    for (let i = 0; i < 2; i++) {
      await page.getByTestId('candidate').first().getByRole('button', { name: 'Добавить' }).click()
      await expect(page.getByTestId('test-item')).toHaveCount(i + 1)
    }
    await expect(page.getByTestId('item-count')).toHaveText('2')
    await page.fill('#set-time', '20')
    await page.getByRole('button', { name: 'Сохранить настройки' }).click()
    await expect(page.locator('#set-time')).toHaveValue('20')
    // изображения еще без подтвержденных прав — тест не готов (BR-024)
    await expect(page.getByTestId('readiness')).toContainText('BR-024')
  })

  test('шаг 8a: преподаватель подтверждает права на изображения (BR-045)', async ({ page }) => {
    await login(page, teacher.email, teacher.password)
    for (const title of [`Куинджи ${stamp}`, `Шишкин ${stamp}`]) {
      await openRecord(page, 'MediaAsset', title)
      await recordAction(page, 'Права')
      await pickSelect(page, 'Статус прав', 'Права подтверждены')
      await submitAndWait(page)
      await expect(page.getByText('Права подтверждены').first()).toBeVisible()
    }
  })

  test('шаг 8: студент отправляет v1 на экспертизу: тест и оба вопроса READY_FOR_REVIEW', async ({ page }) => {
    await login(page, student.email, student.password)
    await openRecord(page, 'Test', `Пейзаж XIX века ${stamp}`)
    await expect(page.getByText('Ошибок нет — тест готов к отправке на экспертизу')).toBeVisible()
    await recordAction(page, 'Отправить на экспертизу')
    await submitAndWait(page)
    await expect(page.getByText('Отправлено на экспертизу').first()).toBeVisible()
    await page.goto('/admin/resources/Item/actions/list')
    await expect(page.locator('tbody tr', { hasText: 'Отправлено на экспертизу' })).toHaveCount(2)
  })

  test('шаг 9: прямой запрос на изменение v1 отклоняется (BR-007)', async ({ page }) => {
    await login(page, student.email, student.password)
    const list = await (await page.request.get('/admin/api/resources/Test/actions/list')).json()
    const t = list.records.find((r: { params: { title: string } }) => r.params.title === `Пейзаж XIX века ${stamp}`)
    const res = await page.request.post(`/admin/api/resources/Test/records/${t.id}/builder`, {
      headers: { Origin: 'http://localhost:3300' },
      data: { op: 'addSection', title: 'Обход заморозки' },
    })
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.message).toMatch(/BR-007/)
  })
})
