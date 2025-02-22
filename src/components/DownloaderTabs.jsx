import React, { useState } from 'react'
import { Tabs, Tab, Box, Typography } from '@mui/material'
import YoutubeDownloader from './YoutubeDownloader'

function TabPanel(props) {
  const { children, value, index, ...other } = props

  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  )
}

function DownloaderTabs() {
  const [value, setValue] = useState(0)

  const handleChange = (event, newValue) => {
    setValue(newValue)
  }

  return (
    <Box sx={{ width: '100%', maxWidth: 800, margin: '0 auto', mt: 4 }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={value} onChange={handleChange} centered>
          <Tab label="YouTube" />
          <Tab label="Instagram" />
          <Tab label="X (Twitter)" />
        </Tabs>
      </Box>
      <TabPanel value={value} index={0}>
        <YoutubeDownloader />
      </TabPanel>
      <TabPanel value={value} index={1}>
        <Typography>Instagram 다운로더 (준비중)</Typography>
      </TabPanel>
      <TabPanel value={value} index={2}>
        <Typography>X 다운로더 (준비중)</Typography>
      </TabPanel>
    </Box>
  )
}

export default DownloaderTabs
