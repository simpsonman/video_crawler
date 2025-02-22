const express = require('express')
const ytdl = require('@distube/ytdl-core')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
const axios = require('axios')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')

puppeteer.use(StealthPlugin())

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

    // YouTube URL 검증
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      return res.status(400).json({ error: '올바른 YouTube URL이 아닙니다' })
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

// sleep 함수 추가
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Instagram 비디오 URL 추출 함수 수정
async function getInstagramVideoUrl(url) {
  console.log('Trying to fetch video from:', url)

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  })

  try {
    const page = await browser.newPage()

    // 디버깅을 위한 콘솔 로그 캡처
    page.on('console', (msg) => console.log('Browser console:', msg.text()))

    await page.setViewport({ width: 1920, height: 1080 })
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    )

    // 네트워크 요청 모니터링
    let videoUrl = null
    let thumbnailUrl = null

    // Request Interception 활성화
    await page.setRequestInterception(true)

    // 모든 네트워크 요청 로깅
    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('video') || url.includes('.mp4')) {
        console.log('Video request detected:', url)
      }
      request.continue()
    })

    page.on('response', async (response) => {
      try {
        const url = response.url()
        const contentType = response.headers()['content-type'] || ''

        if (contentType.includes('video') || url.includes('video') || url.includes('.mp4')) {
          console.log('Potential video URL found:', url)
          console.log('Content-Type:', contentType)
          console.log('Status:', response.status())

          if (response.status() === 200) {
            videoUrl = url
            console.log('Valid video URL found:', videoUrl)
          }
        }
      } catch (error) {
        console.error('Response processing error:', error)
      }
    })

    console.log('Navigating to Instagram page...')
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })
    console.log('Page loaded')

    await sleep(5000)

    // video 태그 찾기
    const hasVideo = await page.evaluate(() => {
      const videos = document.querySelectorAll('video')
      console.log('Found video elements:', videos.length)
      return videos.length > 0
    })

    console.log('Video elements found:', hasVideo)

    if (!videoUrl) {
      console.log('Trying to extract video URL from page...')
      videoUrl = await page.evaluate(() => {
        const videos = Array.from(document.querySelectorAll('video'))
        console.log('Videos found:', videos.length)

        for (const video of videos) {
          console.log('Video element:', {
            src: video.src,
            currentSrc: video.currentSrc,
            poster: video.poster,
          })

          if (video.src && !video.src.startsWith('blob:')) return video.src
          if (video.currentSrc && !video.currentSrc.startsWith('blob:')) return video.currentSrc
        }

        // source 태그도 확인
        const sources = document.querySelectorAll('source')
        for (const source of sources) {
          if (source.src && !source.src.startsWith('blob:')) return source.src
        }

        return null
      })
    }

    await browser.close()
    console.log('Final video URL:', videoUrl)

    if (!videoUrl) {
      throw new Error('비디오 URL을 찾을 수 없습니다')
    }

    return { videoUrl, thumbnailUrl }
  } catch (error) {
    console.error('Error in getInstagramVideoUrl:', error)
    await browser.close()
    throw error
  }
}

// 인스타그램 정보 가져오기
app.post('/api/instagram/info', async (req, res) => {
  try {
    const { url } = req.body
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' })
    }

    // Instagram URL 검증
    if (!url.includes('instagram.com')) {
      return res.status(400).json({ error: '올바른 Instagram URL이 아닙니다' })
    }

    const { videoUrl, thumbnailUrl } = await getInstagramVideoUrl(url)
    if (!videoUrl) {
      throw new Error('비디오 URL을 찾을 수 없습니다')
    }

    res.json({
      url: videoUrl,
      thumbnail: thumbnailUrl || videoUrl,
    })
  } catch (error) {
    console.error('Instagram Error:', error)
    res.status(500).json({ error: '인스타그램 정보를 가져오는데 실패했습니다' })
  }
})

// 인스타그램 비디오 다운로드 함수 수정
app.post('/api/download/instagram/video', async (req, res) => {
  try {
    const { url } = req.body
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' })
    }

    if (!url.includes('instagram.com')) {
      return res.status(400).json({ error: '올바른 Instagram URL이 아닙니다' })
    }

    const { videoUrl } = await getInstagramVideoUrl(url)
    if (!videoUrl) {
      throw new Error('비디오 URL을 찾을 수 없습니다')
    }

    const tempPath = path.join(downloadDir, `instagram_video_${Date.now()}.mp4`)

    try {
      // 먼저 axios로 비디오 다운로드
      const videoResponse = await axios({
        method: 'get',
        url: videoUrl,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8',
          Referer: 'https://www.instagram.com/',
        },
        maxRedirects: 5,
        timeout: 30000,
      })

      // 비디오 데이터를 파일로 저장
      await fs.promises.writeFile(tempPath, Buffer.from(videoResponse.data))

      // 파일 크기 확인
      const stats = await fs.promises.stat(tempPath)
      if (!stats.size) {
        throw new Error('다운로드된 파일이 비어있습니다')
      }

      // 파일 직접 전송
      res.setHeader('Content-Type', 'video/mp4')
      res.setHeader('Content-Disposition', 'attachment; filename=instagram_video.mp4')
      res.setHeader('Content-Length', stats.size)

      const readStream = fs.createReadStream(tempPath)
      readStream.pipe(res)

      // 전송 완료 후 임시 파일 삭제
      readStream.on('end', () => {
        fs.unlink(tempPath, () => {})
      })

      // 에러 처리
      readStream.on('error', (err) => {
        console.error('Stream error:', err)
        fs.unlink(tempPath, () => {})
        if (!res.headersSent) {
          res.status(500).json({ error: '파일 전송 중 오류가 발생했습니다' })
        }
      })
    } catch (err) {
      // 에러 발생 시 임시 파일 정리
      fs.unlink(tempPath, () => {})
      throw err
    }
  } catch (error) {
    console.error('Download Error:', error)
    res.status(500).json({ error: '다운로드 중 오류가 발생했습니다' })
  }
})

// 인스타그램 오디오 다운로드
app.post('/api/download/instagram/audio', async (req, res) => {
  try {
    const { url } = req.body
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' })
    }

    // Instagram URL 검증
    if (!url.includes('instagram.com')) {
      return res.status(400).json({ error: '올바른 Instagram URL이 아닙니다' })
    }

    const { videoUrl } = await getInstagramVideoUrl(url)
    if (!videoUrl) {
      throw new Error('비디오 URL을 찾을 수 없습니다')
    }

    const safeFilename = 'instagram_audio'
    const tempVideoPath = path.join(downloadDir, `${safeFilename}_video.mp4`)
    const outputPath = path.join(downloadDir, `${safeFilename}.mp3`)

    try {
      // 비디오 다운로드
      const videoResponse = await axios.get(videoUrl, { responseType: 'stream' })
      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(tempVideoPath)
        videoResponse.data.pipe(writer)
        writer.on('finish', resolve)
        writer.on('error', reject)
      })

      // FFmpeg를 사용하여 오디오 추출
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(tempVideoPath)
          .outputOptions(['-vn', '-acodec', 'libmp3lame', '-q:a', '0'])
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run()
      })

      // 결과 파일 전송
      res.setHeader('Content-Type', 'audio/mp3')
      res.setHeader('Content-Disposition', `attachment; filename=${safeFilename}.mp3`)
      fs.createReadStream(outputPath).pipe(res)

      // 스트림이 완료되면 임시 파일 삭제
      res.on('finish', () => {
        fs.unlink(tempVideoPath, () => {})
        fs.unlink(outputPath, () => {})
      })
    } catch (err) {
      // 에러 발생 시 임시 파일 정리
      fs.unlink(tempVideoPath, () => {})
      fs.unlink(outputPath, () => {})
      throw err
    }
  } catch (error) {
    console.error('Download Error:', error)
    res.status(500).json({ error: '오디오 추출 중 오류가 발생했습니다' })
  }
})

// Twitter 비디오 URL 추출 함수
async function getTwitterVideoUrl(url) {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  })

  try {
    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    )

    let videoUrls = []
    let thumbnailUrl = null

    await page.setRequestInterception(true)

    page.on('request', (request) => {
      request.continue()
    })

    page.on('response', async (response) => {
      const url = response.url()
      const contentType = response.headers()['content-type'] || ''

      // m3u8 URL 찾기
      if (url.includes('video.twimg.com') && url.includes('.m3u8') && !url.includes('thumb')) {
        console.log('Found M3U8 URL:', url)
        let quality = '360p'
        if (url.includes('720x')) quality = '720p'
        else if (url.includes('480x')) quality = '480p'

        videoUrls.push({
          url: url,
          quality: quality,
          type: 'm3u8',
        })
      }

      // 썸네일 URL 찾기
      if (contentType.includes('image') && url.includes('video_thumb')) {
        thumbnailUrl = url
      }
    })

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })
    await new Promise((resolve) => setTimeout(resolve, 5000))

    await browser.close()

    if (videoUrls.length === 0) {
      throw new Error('비디오 URL을 찾을 수 없습니다')
    }

    // 품질별로 정렬
    videoUrls.sort((a, b) => {
      const getQualityNumber = (q) => parseInt(q.replace('p', ''))
      return getQualityNumber(b.quality) - getQualityNumber(a.quality)
    })

    return {
      formats: videoUrls,
      thumbnail: thumbnailUrl,
    }
  } catch (error) {
    await browser.close()
    throw error
  }
}

// Twitter 정보 가져오기
app.post('/api/twitter/info', async (req, res) => {
  try {
    const { url } = req.body
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' })
    }

    if (!url.includes('twitter.com') && !url.includes('x.com')) {
      return res.status(400).json({ error: '올바른 Twitter/X URL이 아닙니다' })
    }

    const videoInfo = await getTwitterVideoUrl(url)
    res.json(videoInfo)
  } catch (error) {
    console.error('Twitter Error:', error)
    res.status(500).json({ error: 'Twitter 정보를 가져오는데 실패했습니다' })
  }
})

// Twitter 비디오 다운로드
app.post('/api/download/twitter', async (req, res) => {
  try {
    const { url, videoUrl } = req.body
    if (!url || !videoUrl) {
      return res.status(400).json({ error: 'URL이 필요합니다' })
    }

    const tempPath = path.join(downloadDir, `twitter_video_${Date.now()}.mp4`)

    try {
      // ffmpeg를 사용하여 m3u8을 mp4로 변환
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(videoUrl)
          .outputOptions([
            '-c:v',
            'copy', // 비디오 코덱 복사
            '-c:a',
            'aac', // 오디오 코덱 AAC
            '-bsf:a',
            'aac_adtstoasc', // AAC 비트스트림 필터
          ])
          .output(tempPath)
          .on('end', resolve)
          .on('error', (err) => {
            console.error('FFmpeg error:', err)
            reject(err)
          })
          .run()
      })

      res.setHeader('Content-Type', 'video/mp4')
      res.setHeader('Content-Disposition', 'attachment; filename=twitter_video.mp4')

      const readStream = fs.createReadStream(tempPath)
      readStream.pipe(res)

      readStream.on('end', () => {
        fs.unlink(tempPath, () => {})
      })
    } catch (err) {
      fs.unlink(tempPath, () => {})
      throw err
    }
  } catch (error) {
    console.error('Download Error:', error)
    res.status(500).json({ error: '다운로드 중 오류가 발생했습니다' })
  }
})

// Twitter 오디오 다운로드
app.post('/api/download/twitter/audio', async (req, res) => {
  try {
    const { url } = req.body
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' })
    }

    const videoInfo = await getTwitterVideoUrl(url)
    const videoUrl = videoInfo.formats[0].url

    const tempVideoPath = path.join(downloadDir, `twitter_video_${Date.now()}.mp4`)
    const outputPath = path.join(downloadDir, `twitter_audio_${Date.now()}.mp3`)

    try {
      const videoResponse = await axios({
        method: 'get',
        url: videoUrl,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Referer: 'https://twitter.com/',
        },
      })

      await fs.promises.writeFile(tempVideoPath, Buffer.from(videoResponse.data))

      // FFmpeg를 사용하여 오디오 추출
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(tempVideoPath)
          .outputOptions(['-vn', '-acodec', 'libmp3lame', '-q:a', '0'])
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run()
      })

      res.setHeader('Content-Type', 'audio/mp3')
      res.setHeader('Content-Disposition', 'attachment; filename=twitter_audio.mp3')

      const readStream = fs.createReadStream(outputPath)
      readStream.pipe(res)

      readStream.on('end', () => {
        fs.unlink(tempVideoPath, () => {})
        fs.unlink(outputPath, () => {})
      })
    } catch (err) {
      fs.unlink(tempVideoPath, () => {})
      fs.unlink(outputPath, () => {})
      throw err
    }
  } catch (error) {
    console.error('Download Error:', error)
    res.status(500).json({ error: '오디오 추출 중 오류가 발생했습니다' })
  }
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
