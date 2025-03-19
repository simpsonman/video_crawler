const express = require('express')
const ytdl = require('@distube/ytdl-core')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
const axios = require('axios')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const { spawn } = require('child_process')
const { Readable } = require('stream')

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

// YouTube 영상이 라이브 스트리밍인지 확인하는 함수
async function isYoutubeLive(url) {
  try {
    const info = await ytdl.getBasicInfo(url)
    return info.videoDetails.isLiveContent
  } catch (error) {
    console.error('Error checking live status:', error)
    return false
  }
}

// FFmpeg를 사용하여 HLS 스트림 다운로드
function downloadHLSStream(m3u8Url, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(m3u8Url)
      .outputOptions([
        '-c',
        'copy',
        '-bsf:a',
        'aac_adtstoasc',
        '-movflags',
        'frag_keyframe+empty_moov',
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run()
  })
}

// yt-dlp를 사용하여 영상 정보 가져오기
function getVideoInfoWithYtDlp(url) {
  return new Promise((resolve, reject) => {
    const ytDlp = spawn('yt-dlp', ['--dump-json', url])

    let stdout = ''
    let stderr = ''

    ytDlp.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    ytDlp.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp process exited with code ${code}: ${stderr}`))
        return
      }

      try {
        const info = JSON.parse(stdout)
        resolve(info)
      } catch (error) {
        reject(new Error(`Failed to parse yt-dlp output: ${error.message}`))
      }
    })
  })
}

// yt-dlp를 사용하여 라이브 스트리밍 다운로드
function downloadWithYtDlp(url, format, outputPath) {
  return new Promise((resolve, reject) => {
    const args = ['-f', format, '-o', outputPath, '--no-check-certificate', '--no-warnings', url]

    const ytDlp = spawn('yt-dlp', args)

    let stderr = ''
    ytDlp.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp process exited with code ${code}: ${stderr}`))
        return
      }
      resolve()
    })
  })
}

// 비디오 정보 및 포맷 가져오기
app.post('/api/youtube/info', async (req, res) => {
  try {
    const { url } = req.body
    if (!url) {
      return res.status(400).json({ error: 'URL is required' })
    }

    // YouTube URL 검증
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      return res.status(400).json({ error: 'Not a valid YouTube URL' })
    }

    // 라이브 스트리밍인지 확인
    const isLive = await isYoutubeLive(url)

    if (isLive) {
      try {
        // yt-dlp가 설치되어 있는지 확인
        await new Promise((resolve, reject) => {
          const check = spawn('yt-dlp', ['--version'])
          check.on('close', (code) => {
            if (code === 0) resolve()
            else reject(new Error('yt-dlp is not installed'))
          })
        })

        // yt-dlp로 라이브 스트리밍 정보 가져오기
        const info = await getVideoInfoWithYtDlp(url)

        // 포맷 정보 추출
        const formats = info.formats
          .filter((format) => format.resolution !== 'audio only' && format.fps)
          .map((format) => ({
            itag: format.format_id,
            quality: format.resolution,
            fps: format.fps,
            hasAudio: format.acodec !== 'none',
          }))
          .sort((a, b) => {
            const resA = parseInt(a.quality?.split('x')[1] || 0)
            const resB = parseInt(b.quality?.split('x')[1] || 0)
            return resB - resA
          })

        return res.json({
          title: info.title,
          thumbnail: info.thumbnail,
          isLive: true,
          formats,
          isPremiumFeature: true, // 프리미엄 기능 플래그 추가
          premiumMessage: 'Live stream downloads are only available for premium subscribers',
        })
      } catch (error) {
        console.error('yt-dlp error:', error)

        // Fallback: 라이브 스트리밍 기본 포맷만 제공
        return res.json({
          title: '라이브 스트리밍',
          thumbnail: `https://img.youtube.com/vi/${ytdl.getVideoID(url)}/maxresdefault.jpg`,
          isLive: true,
          formats: [
            {
              itag: 'best',
              quality: 'Best available',
              fps: 30,
              hasAudio: true,
            },
          ],
          isPremiumFeature: true, // 프리미엄 기능 플래그 추가
          premiumMessage: 'Live stream downloads are only available for premium subscribers',
        })
      }
    } else {
      // 일반 비디오 처리 (기존 코드)
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
        isLive: false,
        formats,
      })
    }
  } catch (error) {
    console.error('Error:', error)
    res.status(500).json({ error: 'Failed to get video information' })
  }
})

// 다운로드 엔드포인트 수정
app.post('/api/download/youtube', async (req, res) => {
  try {
    const { url, itag } = req.body
    console.log('Received URL:', url, 'itag:', itag)

    if (!url) {
      return res.status(400).json({ error: 'URL is required' })
    }

    // 라이브 스트리밍인지 확인
    const isLive = await isYoutubeLive(url)

    if (isLive) {
      try {
        // 라이브 스트리밍은 프리미엄 전용 기능으로 처리
        return res.status(402).json({
          // 402 Payment Required
          error: 'Live stream downloads are only available for premium subscribers',
          isPremiumFeature: true,
          details: 'Please upgrade your account to access this feature',
        })

        // 기존 라이브 스트리밍 다운로드 코드는 주석 처리합니다.
        /*
        // 임시 파일 경로 설정
        const timestamp = Date.now()
        const outputPath = path.join(downloadDir, `live_stream_${timestamp}.mp4`)

        // 기본 파일명 설정 (실제 타이틀은 나중에 확인)
        let safeFilename = `live_stream_${timestamp}`

        try {
          // yt-dlp로 정보 가져오기 시도
          const info = await getVideoInfoWithYtDlp(url)
          safeFilename = sanitizeFilename(info.title)
        } catch (error) {
          console.error('Error getting live stream info:', error)
        }

        console.log('Downloading live stream to:', outputPath)

        // 라이브 스트리밍 다운로드 - 시간 제한 설정 (-t 15)
        const args = [
          '-f',
          itag === 'best' ? 'best' : itag,
          '-o',
          outputPath,
          '--no-check-certificate',
          '--no-warnings',
          '--max-filesize',
          '10M', // 15초 대신 최대 파일 크기 10MB로 제한
          url,
        ]

        console.log('yt-dlp command:', 'yt-dlp', args.join(' '))

        // 동기적으로 yt-dlp 실행 (Promise로 감싸서)
        await new Promise((resolve, reject) => {
          const downloadProcess = spawn('yt-dlp', args)

          let stderr = ''
          downloadProcess.stderr.on('data', (data) => {
            stderr += data.toString()
            console.log('yt-dlp stderr:', data.toString())
          })

          downloadProcess.stdout.on('data', (data) => {
            console.log('yt-dlp stdout:', data.toString())
          })

          downloadProcess.on('close', (code) => {
            console.log(`yt-dlp process exited with code ${code}`)
            if (code !== 0) {
              console.error(`yt-dlp exited with code ${code}: ${stderr}`)
              reject(new Error(`yt-dlp process exited with code ${code}: ${stderr}`))
              return
            }
            resolve()
          })
        })

        // 파일이 존재하는지 확인
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath)
          if (stats.size === 0) {
            throw new Error('Downloaded file is empty')
          }

          console.log('File exists, sending to client:', outputPath, 'Size:', stats.size)

          res.setHeader('Content-Disposition', `attachment; filename=${safeFilename}.mp4`)
          res.setHeader('Content-Type', 'video/mp4')

          const stream = fs.createReadStream(outputPath)
          stream.pipe(res)

          stream.on('end', () => {
            // 임시 파일 삭제
            fs.unlink(outputPath, (err) => {
              if (err) console.error('Error deleting temp file:', err)
            })
          })
        } else {
          throw new Error('Failed to download live stream - file not created')
        }
        */
      } catch (error) {
        console.error('Live download error:', error)
        res.status(500).json({
          error: 'Failed to process live stream request',
          details: error.message,
        })
      }
    } else {
      // 일반 비디오 다운로드 (기존 코드)
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
    }
  } catch (error) {
    console.error('Download Error:', error)
    res.status(500).json({
      error: 'Download failed',
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
      '--autoplay-policy=no-user-gesture-required',
      '--start-maximized',
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
    let videoUrls = []
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

    // 네트워크 응답 모니터링 - 메인 포스트 비디오 URL 찾기
    page.on('response', async (response) => {
      try {
        const url = response.url()
        const contentType = response.headers()['content-type'] || ''

        // 비디오 URL 찾기 (더 많은 패턴 추가)
        if (
          contentType.includes('video') ||
          url.includes('video') ||
          url.includes('.mp4') ||
          url.includes('cdninstagram.com') ||
          url.includes('fbcdn.net')
        ) {
          console.log('Potential video URL found:', url)
          console.log('Content-Type:', contentType)
          console.log('Status:', response.status())

          if (response.status() === 200) {
            // 품질 정보 추가
            let quality = '일반 화질'
            if (url.includes('high') || url.includes('1080')) {
              quality = '고화질 (1080p)'
            } else if (url.includes('720')) {
              quality = '중간 화질 (720p)'
            }

            videoUrls.push({
              url: url,
              quality: quality,
              type: 'mp4',
              source: 'network',
            })

            console.log('Valid video URL found:', url)
          }
        }

        // 썸네일 URL 찾기
        if (
          (contentType.includes('image') ||
            url.includes('.jpg') ||
            url.includes('.jpeg') ||
            url.includes('.png')) &&
          !thumbnailUrl &&
          response.status() === 200
        ) {
          thumbnailUrl = url
          console.log('Thumbnail URL found:', thumbnailUrl)
        }
      } catch (error) {
        console.error('Response processing error:', error)
      }
    })

    console.log('Navigating to Instagram page...')
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
    console.log('Page loaded')

    // 로그인 팝업 닫기 시도
    try {
      const closeButton = await page.$('button.x1i10hfl[aria-label="Close"]')
      if (closeButton) {
        await closeButton.click()
        console.log('Closed login popup')
        await sleep(1000)
      }
    } catch (err) {
      console.log('No login popup found or failed to close it')
    }

    await sleep(3000)

    // 메인 포스트 영역 찾기 (여러 선택자 시도)
    const mainPostSelectors = [
      'article[role="presentation"]',
      'div[role="dialog"] article',
      'div._aatb._aate',
      'div._ab8w._ab94._ab99._ab9f._ab9m._ab9p._abcm',
    ]

    let mainPostElement = null
    for (const selector of mainPostSelectors) {
      const element = await page.$(selector)
      if (element) {
        mainPostElement = element
        console.log(`Found main post with selector: ${selector}`)
        break
      }
    }

    if (!mainPostElement) {
      console.log('Could not find main post element with any selector')
    }

    // 비디오 재생 버튼 클릭 시도 (여러 선택자 시도)
    const playButtonSelectors = [
      'div[role="button"][tabindex="0"] svg',
      'div[aria-label="재생"]',
      'div[aria-label="Play"]',
      'div._aatk button',
    ]

    for (const selector of playButtonSelectors) {
      try {
        const playButton = await page.$(selector)
        if (playButton) {
          await playButton.click()
          console.log(`Clicked play button with selector: ${selector}`)
          await sleep(2000)
          break
        }
      } catch (err) {
        console.log(`Failed to click play button with selector: ${selector}`)
      }
    }

    // 메인 포스트 내의 비디오 URL 직접 추출 시도
    console.log('Trying to extract video URL directly from main post...')
    const mainPostVideoUrls = await page.evaluate(() => {
      // 메인 포스트 찾기 (여러 선택자 시도)
      const mainPostSelectors = [
        'article[role="presentation"]',
        'div[role="dialog"] article',
        'div._aatb._aate',
        'div._ab8w._ab94._ab99._ab9f._ab9m._ab9p._abcm',
      ]

      let mainPost = null
      for (const selector of mainPostSelectors) {
        const element = document.querySelector(selector)
        if (element) {
          mainPost = element
          console.log(`Found main post with selector: ${selector}`)
          break
        }
      }

      if (!mainPost) {
        console.log('Could not find main post element')
        return []
      }

      // 메인 포스트 내의 모든 비디오 요소 찾기
      const videos = Array.from(mainPost.querySelectorAll('video'))
      console.log(`Found ${videos.length} video elements in main post`)

      const results = []

      // 비디오 요소에서 URL 추출
      for (const video of videos) {
        console.log('Video element properties:', {
          src: video.src,
          currentSrc: video.currentSrc,
          poster: video.poster,
        })

        if (video.src && !video.src.startsWith('blob:')) {
          results.push({
            url: video.src,
            quality: '직접 추출 비디오',
            type: 'mp4',
            source: 'direct',
          })
        }

        if (
          video.currentSrc &&
          !video.currentSrc.startsWith('blob:') &&
          video.currentSrc !== video.src
        ) {
          results.push({
            url: video.currentSrc,
            quality: '직접 추출 비디오 (currentSrc)',
            type: 'mp4',
            source: 'direct',
          })
        }
      }

      // source 태그 확인
      const sources = mainPost.querySelectorAll('source')
      for (const source of sources) {
        if (source.src && !source.src.startsWith('blob:')) {
          results.push({
            url: source.src,
            quality: '직접 추출 비디오 (source)',
            type: 'mp4',
            source: 'direct',
          })
        }
      }

      return results
    })

    // 직접 추출한 URL 추가
    if (mainPostVideoUrls.length > 0) {
      console.log('Found video URLs directly from main post:', mainPostVideoUrls)
      videoUrls.push(...mainPostVideoUrls)
    }

    // 페이지 소스에서 비디오 URL 추출 시도
    console.log('Trying to extract video URL from page source...')
    const pageSource = await page.content()

    // 정규식으로 비디오 URL 추출 시도 (인스타그램 비디오 패턴에 맞게 조정)
    const videoRegexPatterns = [
      /https:\/\/[^"']*\.mp4[^"']*/g,
      /https:\/\/scontent[^"']*\.cdninstagram\.com[^"']*video[^"']*/g,
      /https:\/\/instagram\.[\w]+\.fbcdn\.net[^"']*video[^"']*/g,
    ]

    for (const pattern of videoRegexPatterns) {
      const matches = pageSource.match(pattern)
      if (matches && matches.length > 0) {
        console.log(`Found ${matches.length} video URLs with pattern:`, pattern)

        // 중복 제거
        const uniqueUrls = [...new Set(matches)]

        uniqueUrls.forEach((url) => {
          videoUrls.push({
            url: url,
            quality: '정규식 추출 비디오',
            type: 'mp4',
            source: 'regex',
          })
        })
      }
    }

    // JSON 데이터에서 비디오 URL 추출 시도
    console.log('Trying to extract video URL from JSON data...')
    const jsonVideoUrls = await page.evaluate(() => {
      const results = []

      // 페이지 내의 모든 script 태그 검사
      const scripts = document.querySelectorAll('script[type="application/json"]')
      for (const script of scripts) {
        try {
          const jsonData = JSON.parse(script.textContent)

          // JSON 데이터에서 비디오 URL 찾기 (재귀 함수)
          function findVideoUrls(obj, path = '') {
            if (!obj || typeof obj !== 'object') return

            // 비디오 URL을 포함할 가능성이 있는 키 이름
            const videoKeys = ['video_url', 'video_src', 'src', 'url', 'video_versions']

            for (const key in obj) {
              const newPath = path ? `${path}.${key}` : key

              // 값이 URL 문자열이고 비디오 관련 키인 경우
              if (
                typeof obj[key] === 'string' &&
                videoKeys.some((vk) => key.toLowerCase().includes(vk.toLowerCase())) &&
                (obj[key].includes('.mp4') || obj[key].includes('video'))
              ) {
                console.log(`Found video URL in JSON at path ${newPath}:`, obj[key])
                results.push({
                  url: obj[key],
                  quality: 'JSON 추출 비디오',
                  type: 'mp4',
                  source: 'json',
                  path: newPath,
                })
              }
              // 배열인 경우 각 항목 검사
              else if (Array.isArray(obj[key])) {
                obj[key].forEach((item, index) => {
                  findVideoUrls(item, `${newPath}[${index}]`)
                })
              }
              // 객체인 경우 재귀 호출
              else if (typeof obj[key] === 'object' && obj[key] !== null) {
                findVideoUrls(obj[key], newPath)
              }
            }
          }

          findVideoUrls(jsonData)
        } catch (err) {
          console.log('Error parsing JSON from script tag:', err)
        }
      }

      return results
    })

    // JSON에서 추출한 URL 추가
    if (jsonVideoUrls.length > 0) {
      console.log('Found video URLs from JSON data:', jsonVideoUrls)
      videoUrls.push(...jsonVideoUrls)
    }

    // 썸네일 추출 시도
    if (!thumbnailUrl) {
      thumbnailUrl = await page.evaluate(() => {
        // 메인 포스트 찾기 (여러 선택자 시도)
        const mainPostSelectors = [
          'article[role="presentation"]',
          'div[role="dialog"] article',
          'div._aatb._aate',
          'div._ab8w._ab94._ab99._ab9f._ab9m._ab9p._abcm',
        ]

        let mainPost = null
        for (const selector of mainPostSelectors) {
          const element = document.querySelector(selector)
          if (element) {
            mainPost = element
            break
          }
        }

        if (mainPost) {
          // 메인 포스트 내에서 찾기
          const video = mainPost.querySelector('video')
          if (video && video.poster) return video.poster

          // 큰 이미지 찾기
          const images = Array.from(mainPost.querySelectorAll('img'))
          const mainImage = images.find((img) => img.width > 200 && img.height > 200)
          if (mainImage) return mainImage.src
        }

        // 메인 포스트를 찾지 못했거나 이미지가 없는 경우 전체 페이지에서 찾기
        const video = document.querySelector('video')
        if (video && video.poster) return video.poster

        const images = Array.from(document.querySelectorAll('img'))
        const mainImage = images.find((img) => img.width > 200 && img.height > 200)
        return mainImage ? mainImage.src : null
      })

      if (thumbnailUrl) {
        console.log('Found thumbnail URL:', thumbnailUrl)
      }
    }

    await browser.close()
    console.log('Final video URLs count:', videoUrls.length)

    if (videoUrls.length === 0) {
      throw new Error('비디오 URL을 찾을 수 없습니다')
    }

    // 소스 및 품질에 따라 우선순위 부여
    videoUrls.forEach((format) => {
      // 소스 기반 우선순위
      if (format.source === 'direct') format.priority = 10
      else if (format.source === 'json') format.priority = 8
      else if (format.source === 'network') format.priority = 5
      else if (format.source === 'regex') format.priority = 3
      else format.priority = 1

      // 품질 기반 추가 우선순위
      if (format.quality.includes('고화질')) format.priority += 2
      else if (format.quality.includes('중간')) format.priority += 1
    })

    // 우선순위에 따라 정렬
    videoUrls.sort((a, b) => b.priority - a.priority)

    // 중복 URL 제거
    const uniqueUrls = []
    const seen = new Set()

    for (const format of videoUrls) {
      if (!seen.has(format.url)) {
        seen.add(format.url)
        uniqueUrls.push(format)
      }
    }

    console.log('Final unique video URLs:', uniqueUrls)

    return {
      formats: uniqueUrls,
      thumbnail: thumbnailUrl,
    }
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

    const videoInfo = await getInstagramVideoUrl(url)
    res.json(videoInfo)
  } catch (error) {
    console.error('Instagram Error:', error)
    res.status(500).json({ error: '인스타그램 정보를 가져오는데 실패했습니다' })
  }
})

// 인스타그램 비디오 다운로드 함수 수정
app.post('/api/download/instagram/video', async (req, res) => {
  try {
    const { url, videoUrl } = req.body
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' })
    }

    if (!url.includes('instagram.com')) {
      return res.status(400).json({ error: '올바른 Instagram URL이 아닙니다' })
    }

    // videoUrl이 제공되면 사용, 아니면 직접 가져오기
    let targetVideoUrl = videoUrl
    if (!targetVideoUrl) {
      const videoInfo = await getInstagramVideoUrl(url)
      targetVideoUrl = videoInfo.formats[0].url
    }

    const tempPath = path.join(downloadDir, `instagram_video_${Date.now()}.mp4`)

    try {
      // 먼저 axios로 비디오 다운로드
      const videoResponse = await axios({
        method: 'get',
        url: targetVideoUrl,
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
    const { url, videoUrl } = req.body
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' })
    }

    // Instagram URL 검증
    if (!url.includes('instagram.com')) {
      return res.status(400).json({ error: '올바른 Instagram URL이 아닙니다' })
    }

    // videoUrl이 제공되면 사용, 아니면 직접 가져오기
    let targetVideoUrl = videoUrl
    if (!targetVideoUrl) {
      const videoInfo = await getInstagramVideoUrl(url)
      targetVideoUrl = videoInfo.formats[0].url
    }

    const safeFilename = 'instagram_audio'
    const tempVideoPath = path.join(downloadDir, `${safeFilename}_video_${Date.now()}.mp4`)
    const outputPath = path.join(downloadDir, `${safeFilename}_${Date.now()}.mp3`)

    try {
      // 비디오 다운로드
      const videoResponse = await axios({
        method: 'get',
        url: targetVideoUrl,
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
      await fs.promises.writeFile(tempVideoPath, Buffer.from(videoResponse.data))

      // FFmpeg를 사용하여 오디오 추출
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(tempVideoPath)
          .outputOptions(['-vn', '-acodec', 'libmp3lame', '-q:a', '0'])
          .output(outputPath)
          .on('end', resolve)
          .on('error', (err) => {
            console.error('FFmpeg Error:', err)
            reject(err)
          })
          .run()
      })

      // 결과 파일 전송
      res.setHeader('Content-Type', 'audio/mp3')
      res.setHeader('Content-Disposition', `attachment; filename=${safeFilename}.mp3`)

      const stats = await fs.promises.stat(outputPath)
      res.setHeader('Content-Length', stats.size)

      const readStream = fs.createReadStream(outputPath)
      readStream.pipe(res)

      // 스트림이 완료되면 임시 파일 삭제
      readStream.on('end', () => {
        fs.unlink(tempVideoPath, () => {})
        fs.unlink(outputPath, () => {})
      })

      // 에러 처리
      readStream.on('error', (err) => {
        console.error('Stream error:', err)
        fs.unlink(tempVideoPath, () => {})
        fs.unlink(outputPath, () => {})
        if (!res.headersSent) {
          res.status(500).json({ error: '파일 전송 중 오류가 발생했습니다' })
        }
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
      '--autoplay-policy=no-user-gesture-required',
      '--start-maximized',
    ],
  })

  try {
    const page = await browser.newPage()

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    )

    let videoUrls = []
    let audioUrl = null
    let thumbnailUrl = null

    await page.setRequestInterception(true)

    page.on('request', (request) => {
      request.continue()
    })

    page.on('response', async (response) => {
      const url = response.url()
      const contentType = response.headers()['content-type'] || ''

      // 비디오 스트림 URL 찾기 (m3u8)
      if (url.includes('video.twimg.com') && url.includes('.m3u8') && !url.includes('thumb')) {
        console.log('Found Video M3U8 URL:', url)
        let quality = '360p'
        if (url.includes('720x')) quality = '720p'
        else if (url.includes('480x')) quality = '480p'

        videoUrls.push({
          url: url,
          quality: quality,
          type: 'm3u8',
        })
      }

      // 오디오 URL 찾기 (m4s 포함)
      if (
        url.includes('video.twimg.com') &&
        (url.includes('/aud/') || url.includes('audio')) &&
        !url.includes('thumb') &&
        (url.includes('.m4s') || url.includes('.mp4'))
      ) {
        console.log('Found Audio URL:', url)
        // 가장 높은 품질의 오디오 선택 (128kbps)
        if (!audioUrl || url.includes('128000')) {
          audioUrl = url
        }
      }
    })

    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    })

    // 비디오 플레이어가 로드될 때까지 대기
    await page.waitForSelector('video', { timeout: 10000 })

    // 비디오 플레이어 초기화 대기
    await page.waitForFunction(
      () => {
        const video = document.querySelector('video')
        return video && video.readyState >= 2
      },
      { timeout: 10000 },
    )

    // 오디오 활성화 및 재생
    await page.evaluate(() => {
      const video = document.querySelector('video')
      if (video) {
        // 오디오 설정
        video.muted = false
        video.volume = 1

        // 이벤트 리스너 추가
        video.addEventListener('volumechange', () => {
          if (video.muted) {
            video.muted = false
            video.volume = 1
          }
        })

        // 재생 시도
        const playPromise = video.play()
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            // 자동 재생이 실패해도 계속 진행
            console.log('Autoplay failed, but continuing...')
          })
        }
      }
    })

    // 추가 대기 시간
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
      audioUrl: audioUrl,
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
    const { url } = req.body
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' })
    }

    const videoInfo = await getTwitterVideoUrl(url)
    const videoUrl = videoInfo.formats[0].url

    const tempVideoPath = path.join(downloadDir, `twitter_video_${Date.now()}.mp4`)
    const tempAudioPath = path.join(downloadDir, `twitter_audio_${Date.now()}.mp3`)
    const outputPath = path.join(downloadDir, `twitter_final_${Date.now()}.mp4`)

    try {
      // 비디오 다운로드
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(videoUrl)
          .inputOptions([
            '-protocol_whitelist',
            'file,http,https,tcp,tls,crypto,pipe,hls',
            '-allowed_extensions',
            'ALL',
          ])
          .outputOptions(['-c', 'copy'])
          .output(tempVideoPath)
          .on('end', resolve)
          .on('error', reject)
          .run()
      })

      // 비디오에서 오디오 추출
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(videoUrl)
          .inputOptions([
            '-protocol_whitelist',
            'file,http,https,tcp,tls,crypto,pipe,hls',
            '-allowed_extensions',
            'ALL',
          ])
          .outputOptions(['-vn', '-acodec', 'libmp3lame', '-q:a', '2'])
          .output(tempAudioPath)
          .on('end', resolve)
          .on('error', reject)
          .run()
      })

      // 비디오와 오디오 합치기
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(tempVideoPath)
          .input(tempAudioPath)
          .outputOptions([
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-strict',
            'experimental',
            '-map',
            '0:v:0',
            '-map',
            '1:a:0',
          ])
          .on('start', (commandLine) => {
            console.log('FFmpeg command:', commandLine)
          })
          .on('end', resolve)
          .on('error', reject)
          .save(outputPath)
      })

      res.setHeader('Content-Type', 'video/mp4')
      res.setHeader('Content-Disposition', 'attachment; filename=twitter_video.mp4')

      const readStream = fs.createReadStream(outputPath)
      readStream.pipe(res)

      readStream.on('end', () => {
        fs.unlink(tempVideoPath, () => {})
        fs.unlink(tempAudioPath, () => {})
        fs.unlink(outputPath, () => {})
      })
    } catch (err) {
      fs.unlink(tempVideoPath, () => {})
      fs.unlink(tempAudioPath, () => {})
      if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {})
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
