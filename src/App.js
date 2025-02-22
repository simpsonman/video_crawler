import React from 'react'
import { Container, CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import DownloaderTabs from './components/DownloaderTabs'

const theme = createTheme()

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container>
        <DownloaderTabs />
      </Container>
    </ThemeProvider>
  )
}

export default App
