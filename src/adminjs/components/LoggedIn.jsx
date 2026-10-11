import React from 'react'
import { Box, CurrentUserNav, Icon } from '@adminjs/design-system'
import { useTranslation } from 'adminjs'

/** Верхнее меню: ссылка на справочник пользователя рядом с данными пользователя (замена LoggedIn AdminJS). */
const LoggedIn = ({ session, paths }) => {
  const { translateButton } = useTranslation()
  const dropActions = [
    {
      label: translateButton('logout'),
      onClick: (event) => {
        event.preventDefault()
        window.location.href = paths.logoutPath
      },
      icon: 'LogOut',
    },
  ]
  return (
    <Box flex flexShrink={0} alignItems="center" data-css="logged-in">
      <a
        href="/guide/"
        target="_blank"
        rel="noopener"
        data-testid="guide-link"
        title="Справочник пользователя"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginRight: 16,
          color: 'inherit',
          textDecoration: 'none',
          fontSize: 14,
        }}
      >
        <Icon icon="HelpCircle" />
        Справочник
      </a>
      <CurrentUserNav
        name={session.email}
        title={session.title}
        avatarUrl={session.avatarUrl}
        dropActions={dropActions}
      />
    </Box>
  )
}

export default LoggedIn
