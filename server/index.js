const express = require('express')
const ytdl = require('@distube/ytdl-core')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()

app.use(cors())
app.use(express.json())

// 임시 다운로드 폴더 생성
const downloadDir = path.join(__dirname, 'downloads')
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir)
}

// 테스트 엔드포인트
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working!' })
})

// 파일 이름에서 특수 문자 제거하는 함수
function sanitizeFilename(filename) {
  // ASCII 문자만 허용하고 나머지는 제거
  const safeFilename =
    filename
      .replace(/[^\x00-\x7F]/g, '') // non-ASCII 문자 제거
      .replace(/[^a-zA-Z0-9]/g, '_') // 특수 문자를 언더스코어로 변경
      .replace(/_+/g, '_') // 여러 개의 언더스코어를 하나로
      .replace(/^_|_$/g, '') || // 시작과 끝의 언더스코어 제거
    'video' // 빈 문자열인 경우 기본값

  return encodeURIComponent(safeFilename) // URL 인코딩 적용
}

app.post('/api/download/youtube', async (req, res) => {
  try {
    const { url } = req.body
    console.log('Received URL:', url)

    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' })
    }

    const info = await ytdl.getInfo(url)
    const format = ytdl.chooseFormat(info.formats, {
      quality: 'highestvideo',
      filter: 'videoandaudio',
    })

    const safeFilename = sanitizeFilename(info.videoDetails.title)
    res.setHeader('Content-Disposition', `attachment; filename=${safeFilename}.mp4`)
    res.setHeader('Content-Type', 'video/mp4')

    ytdl(url, { format: format }).pipe(res)
  } catch (error) {
    console.error('Download Error:', error)
    res.status(500).json({
      error: '다운로드 중 오류가 발생했습니다',
      details: error.message,
    })
  }
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
