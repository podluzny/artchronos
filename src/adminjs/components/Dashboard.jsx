import React from 'react'
import { Box, H2, Text } from '@adminjs/design-system'
import { useCurrentAdmin } from 'adminjs'

const Dashboard = () => {
  const [currentAdmin] = useCurrentAdmin()
  return (
    <Box variant="container" m="xl">
      <H2>ArtChronos</H2>
      <Text mb="lg">Административная система подготовки, экспертизы и публикации тестов по искусству.</Text>
      {currentAdmin ? (
        <Text>
          Вы вошли как {currentAdmin.title} ({currentAdmin.email}).
        </Text>
      ) : null}
      <Text mt="lg">
        Документация проекта (SDD): <a href="/sdd/">/sdd/</a> · Смена пароля:{' '}
        <a href="/account/password">/account/password</a>
      </Text>
    </Box>
  )
}

export default Dashboard
