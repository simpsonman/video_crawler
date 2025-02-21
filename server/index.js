const express = require('express')
const ytdl = require('@distube/ytdl-core')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')

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

// 비디오 정보 및 포맷 가져오기
app.post('/api/youtube/info', async (req, res) => {
  try {
    const { url } = req.body
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' })
    }

    const info = await ytdl.getInfo(url)

    // 최고 품질의 오디오 포맷 찾기
    const bestAudioFormat = ytdl.chooseFormat(info.formats, {
      quality: 'highestaudio',
      filter: 'audioonly',
    })

    // 비디오 포맷 필터링 및 정리
    const uniqueFormats = new Map()
    info.formats
      .filter((format) => format.hasVideo && format.contentLength) // 비디오가 있는 포맷만 선택
      .forEach((format) => {
        const key = `${format.qualityLabel}_${format.fps}`
        const current = uniqueFormats.get(key)

        // 오디오가 있는 포맷 우선, 없으면 나중에 합성
        const shouldUpdate = !current || format.bitrate > current.bitrate

        if (shouldUpdate) {
          uniqueFormats.set(key, {
            itag: format.itag,
            quality: format.qualityLabel,
            fps: format.fps,
            hasAudio: format.hasAudio,
            bitrate: format.bitrate,
            videoFormat: format,
            audioFormat: format.hasAudio ? null : bestAudioFormat, // 오디오가 없으면 최고 품질 오디오 포맷 저장
          })
        }
      })

    // Map을 배열로 변환하고 정렬
    const formats = Array.from(uniqueFormats.values())
      .sort((a, b) => {
        // 해상도로 정렬
        const resA = parseInt(a.quality?.replace('p', '') || 0)
        const resB = parseInt(b.quality?.replace('p', '') || 0)
        if (resA !== resB) return resB - resA
        // 해상도가 같으면 FPS로 정렬
        return b.fps - a.fps
      })
      .map(({ videoFormat, audioFormat, ...format }) => format) // 클라이언트에 필요한 정보만 전송

    res.json({
      title: info.videoDetails.title,
      thumbnail: info.videoDetails.thumbnails[0].url,
      formats,
    })
  } catch (error) {
    console.error('Error:', error)
    res.status(500).json({ error: '비디오 정보를 가져오는데 실패했습니다' })
  }
})

// 다운로드 엔드포인트 수정
app.post('/api/download/youtube', async (req, res) => {
  try {
    const { url, itag } = req.body
    console.log('Received URL:', url, 'itag:', itag)

    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' })
    }

    const info = await ytdl.getInfo(url)
    const videoFormat = info.formats.find((f) => f.itag === itag)
    const safeFilename = sanitizeFilename(info.videoDetails.title)

    // 항상 최고 품질의 오디오를 가져옴
    const audioFormat = ytdl.chooseFormat(info.formats, {
      quality: 'highestaudio',
      filter: 'audioonly',
    })

    // 임시 파일 경로 설정
    const tempVideoPath = path.join(downloadDir, `${safeFilename}_video.mp4`)
    const tempAudioPath = path.join(downloadDir, `${safeFilename}_audio.mp3`)
    const outputPath = path.join(downloadDir, `${safeFilename}_final.mp4`)

    try {
      // 비디오 다운로드
      await new Promise((resolve, reject) => {
        const video = ytdl(url, { format: videoFormat })
        video.pipe(fs.createWriteStream(tempVideoPath)).on('finish', resolve).on('error', reject)
      })

      // 오디오 다운로드
      await new Promise((resolve, reject) => {
        const audio = ytdl(url, { format: audioFormat })
        audio.pipe(fs.createWriteStream(tempAudioPath)).on('finish', resolve).on('error', reject)
      })

      // FFmpeg를 사용하여 비디오와 오디오 합치기
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(tempVideoPath)
          .input(tempAudioPath)
          .outputOptions([
            '-c:v copy',
            '-c:a aac',
            '-strict experimental',
            '-map 0:v:0',
            '-map 1:a:0',
            '-shortest',
          ])
          .output(outputPath)
          .on('end', resolve)
          .on('error', (err) => {
            console.error('FFmpeg Error:', err)
            reject(err)
          })
          .run()
      })

      // 결과 파일 전송
      res.setHeader('Content-Disposition', `attachment; filename=${safeFilename}.mp4`)
      res.setHeader('Content-Type', 'video/mp4')

      const stream = fs.createReadStream(outputPath)
      stream.pipe(res)

      // 스트림이 완료되면 임시 파일들 삭제
      stream.on('end', () => {
        fs.unlink(tempVideoPath, () => {})
        fs.unlink(tempAudioPath, () => {})
        fs.unlink(outputPath, () => {})
      })
    } catch (err) {
      console.error('Processing Error:', err)
      // 에러 발생 시 임시 파일 정리
      fs.unlink(tempVideoPath, () => {})
      fs.unlink(tempAudioPath, () => {})
      fs.unlink(outputPath, () => {})
      throw err
    }
  } catch (error) {
    console.error('Download Error:', error)
    res.status(500).json({
      error: '다운로드 중 오류가 발생했습니다',
      details: error.message,
    })
  }
})

// 오디오 다운로드 엔드포인트 추가
app.post('/api/download/youtube/audio', async (req, res) => {
  try {
    const { url } = req.body
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' })
    }

    const info = await ytdl.getInfo(url)
    const audioFormat = ytdl.chooseFormat(info.formats, {
      quality: 'highestaudio',
      filter: 'audioonly',
    })

    const safeFilename = sanitizeFilename(info.videoDetails.title)
    const tempAudioPath = path.join(downloadDir, `${safeFilename}_audio.mp3`)
    const outputPath = path.join(downloadDir, `${safeFilename}_final.mp3`)

    try {
      // 오디오 다운로드
      await new Promise((resolve, reject) => {
        const audio = ytdl(url, { format: audioFormat })
        audio.pipe(fs.createWriteStream(tempAudioPath)).on('finish', resolve).on('error', reject)
      })

      // FFmpeg를 사용하여 MP3로 변환
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(tempAudioPath)
          .outputOptions([
            '-c:a libmp3lame', // MP3 인코더 사용
            '-q:a 0', // 최고 품질
          ])
          .output(outputPath)
          .on('end', resolve)
          .on('error', (err) => {
            console.error('FFmpeg Error:', err)
            reject(err)
          })
          .run()
      })

      // 결과 파일 전송
      res.setHeader('Content-Disposition', `attachment; filename=${safeFilename}.mp3`)
      res.setHeader('Content-Type', 'audio/mp3')

      const stream = fs.createReadStream(outputPath)
      stream.pipe(res)

      // 스트림이 완료되면 임시 파일들 삭제
      stream.on('end', () => {
        fs.unlink(tempAudioPath, () => {})
        fs.unlink(outputPath, () => {})
      })
    } catch (err) {
      console.error('Processing Error:', err)
      // 에러 발생 시 임시 파일 정리
      fs.unlink(tempAudioPath, () => {})
      fs.unlink(outputPath, () => {})
      throw err
    }
  } catch (error) {
    console.error('Download Error:', error)
    res.status(500).json({
      error: '오디오 다운로드 중 오류가 발생했습니다',
      details: error.message,
    })
  }
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
