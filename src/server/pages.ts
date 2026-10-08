/** Простые серверные страницы аккаунта (смена/установка пароля). Без внешних ресурсов. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ArtChronos</title>
<style>
:root{--bg:#f6f7fb;--card:#fff;--text:#1f2933;--muted:#5f6b7a;--accent:#3040d6;--err:#c0352b;--ok:#1d7a46;--border:#d9dde5}
@media (prefers-color-scheme: dark){:root{--bg:#14161c;--card:#1d2028;--text:#e8eaf0;--muted:#a3abba;--accent:#8c97ff;--err:#ff7b6e;--ok:#5fd394;--border:#343946}}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text)}
main{max-width:440px;margin:8vh auto;padding:0 16px}.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:28px}
h1{font-size:22px;margin:0 0 6px}p{color:var(--muted);margin:0 0 18px}label{display:block;font-weight:600;margin:14px 0 6px}
input{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:6px;font:inherit;background:var(--bg);color:var(--text)}
button{margin-top:20px;width:100%;padding:11px;border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.err{color:var(--err);margin:12px 0 0}.ok{color:var(--ok)}ul.err{padding-left:18px}a{color:var(--accent)}
</style></head><body><main><div class="card">${body}</div></main></body></html>`
}

export function passwordForm(opts: {
  title: string
  intro: string
  action: string
  needCurrent: boolean
  token?: string
  errors?: string[]
}): string {
  const errs = opts.errors?.length
    ? `<ul class="err">${opts.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
    : ''
  return page(
    opts.title,
    `<h1>${escapeHtml(opts.title)}</h1><p>${escapeHtml(opts.intro)}</p>
<form method="post" action="${escapeHtml(opts.action)}" autocomplete="off">
${opts.token ? `<input type="hidden" name="token" value="${escapeHtml(opts.token)}">` : ''}
${opts.needCurrent ? '<label for="currentPassword">Текущий пароль</label><input id="currentPassword" name="currentPassword" type="password" required autocomplete="current-password">' : ''}
<label for="newPassword">Новый пароль</label><input id="newPassword" name="newPassword" type="password" required minlength="12" autocomplete="new-password">
<label for="confirm">Повторите пароль</label><input id="confirm" name="confirm" type="password" required minlength="12" autocomplete="new-password">
${errs}<button type="submit">Сохранить пароль</button></form>
<p style="margin-top:18px">Не менее 12 символов; не должен совпадать с email.</p>`,
  )
}
