import React, { useState } from 'react'
import { TextField, Button, Box, Typography, CircularProgress } from '@mui/material'

function YoutubeDownloader() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleDownload = async () => {
    if (!url) {
      setError('URL을 입력해주세요')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/download/youtube', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      })

      if (!response.ok) {
        throw new Error('다운로드 중 오류가 발생했습니다')
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = 'youtube-video.mp4'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(downloadUrl)
      document.body.removeChild(a)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="h6">YouTube 비디오 다운로더</Typography>
      <TextField
        fullWidth
        label="YouTube URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        error={!!error}
        helperText={error}
      />
      <Button
        variant="contained"
        onClick={handleDownload}
        disabled={loading}
        sx={{ alignSelf: 'flex-start' }}
      >
        {loading ? <CircularProgress size={24} /> : '다운로드'}
      </Button>
    </Box>
  )
}

export default YoutubeDownloader
