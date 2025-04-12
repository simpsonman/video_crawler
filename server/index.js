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
    // yt-dlp를 사용하여 확인
    const info = await getVideoInfoWithYtDlp(url)
    return info.is_live || false
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
    // yt-dlp 명령어 구성 - 추가 옵션으로 안정성 강화
    const args = [
      '--dump-json',
      '--no-warnings',
      '--no-check-certificate',
      '--no-playlist',
      '--no-progress',
      url,
    ]

    console.log(`Running yt-dlp with args: ${args.join(' ')}`)
    const ytDlp = spawn('yt-dlp', args)

    let stdout = ''
    let stderr = ''

    ytDlp.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    ytDlp.stderr.on('data', (data) => {
      stderr += data.toString()
      console.error(`yt-dlp stderr: ${data}`)
    })

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        console.error(`yt-dlp process exited with code ${code}: ${stderr}`)
        reject(new Error(`yt-dlp process exited with code ${code}: ${stderr}`))
        return
      }

      try {
        // stdout에서 JSON 데이터 추출 (여러 줄에 걸쳐 있는 경우 처리)
        const jsonData = stdout.trim()
        if (!jsonData) {
          reject(new Error('No data returned from yt-dlp'))
          return
        }

        const info = JSON.parse(jsonData)

        // 중요한 프로퍼티 유효성 검사
        if (!info) {
          reject(new Error('Failed to parse video info'))
          return
        }

        // 기본 메타데이터가 없는 경우 기본값 추가
        info.id = info.id || url.split('v=')[1]?.split('&')[0] || url.split('/').pop()
        info.title = info.title || 'Unknown Title'
        info.thumbnail = info.thumbnail || `https://img.youtube.com/vi/${info.id}/maxresdefault.jpg`

        resolve(info)
      } catch (error) {
        console.error(`Failed to parse yt-dlp output: ${error.message}`, stdout)
        reject(new Error(`Failed to parse yt-dlp output: ${error.message}`))
      }
    })

    // 타임아웃 설정
    setTimeout(() => {
      ytDlp.kill()
      reject(new Error('yt-dlp process timed out after 30 seconds'))
    }, 30000)
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

    // yt-dlp 명령어를 사용하여 비디오 정보 가져오기
    try {
      // yt-dlp가 설치되어 있는지 확인
      const checkResult = await new Promise((resolve, reject) => {
        const check = spawn('yt-dlp', ['--version'])
        let output = ''
        check.stdout.on('data', (data) => {
          output += data.toString()
        })
        check.on('close', (code) => {
          if (code === 0) resolve(output.trim())
          else reject(new Error('yt-dlp is not installed'))
        })
      })

      console.log('Using yt-dlp version:', checkResult)

      // yt-dlp로 비디오 정보 가져오기
      const videoInfo = await getVideoInfoWithYtDlp(url)
      console.log('Got video info from yt-dlp')

      // 라이브 스트리밍인지 확인
      const isLive = videoInfo.is_live || false

      if (isLive) {
        // 라이브 스트리밍은 프리미엄 전용 기능으로 표시
        const videoId = videoInfo.id || ytdl.getVideoID(url)
        return res.json({
          title: videoInfo.title || 'Live Stream',
          thumbnail:
            videoInfo.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          isLive: true,
          formats: [
            {
              itag: 'best',
              quality: 'Best quality',
              fps: 30,
              hasAudio: true,
            },
          ],
          isPremiumFeature: true,
          premiumMessage: 'Live stream downloads are available only for premium subscribers',
        })
      } else {
        // 일반 비디오 포맷 추출
        const formats = videoInfo.formats
          .filter(
            (format) =>
              format.vcodec !== 'none' && // 비디오가 있는 포맷만
              !format.format_note?.includes('storyboard') && // 스토리보드 제외
              format.format_id !== 'sb0', // 잘못된 포맷 제외
          )
          .map((format) => ({
            itag: format.format_id,
            quality: format.height ? `${format.height}p` : format.resolution || 'Unknown',
            fps: format.fps || 0,
            hasAudio: format.acodec !== 'none',
          }))
          .sort((a, b) => {
            // 해상도로 정렬
            const resA = parseInt(a.quality?.replace('p', '') || 0)
            const resB = parseInt(b.quality?.replace('p', '') || 0)
            if (resA !== resB) return resB - resA
            // 해상도가 같으면 FPS로 정렬
            return (b.fps || 0) - (a.fps || 0)
          })

        // 최소한 하나의 포맷이 있는지 확인
        if (!formats || formats.length === 0) {
          formats.push({
            itag: 'best',
            quality: 'Best available',
            fps: 30,
            hasAudio: true,
          })
        }

        return res.json({
          title: videoInfo.title || 'Unknown Title',
          thumbnail:
            videoInfo.thumbnail || `https://img.youtube.com/vi/${videoInfo.id}/maxresdefault.jpg`,
          isLive: false,
          formats,
        })
      }
    } catch (ytDlpError) {
      // yt-dlp 에러 발생시 로그 출력
      console.error('yt-dlp error:', ytDlpError)

      // ytdl-core 방식으로 폴백 시도 (더 이상 사용하지 않음)
      throw new Error('yt-dlp failed: ' + ytDlpError.message)
    }
  } catch (error) {
    console.error('Error in info endpoint:', error)
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

    // 임시 파일 저장 디렉토리 확인
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true })
    }

    try {
      // 간단한 고유 ID 생성
      const timestamp = Date.now()
      const randomStr = Math.random().toString(36).substring(2, 8)
      const safeFilename = `youtube_${timestamp}_${randomStr}`
      const outputPath = path.join(downloadDir, `${safeFilename}.mp4`)

      // yt-dlp 명령어 구성 (비디오와 오디오 모두 다운로드하도록 수정)
      let formatOptions = ''

      if (itag && itag !== 'best') {
        // 특정 itag가 지정된 경우 해당 포맷 사용
        formatOptions = `-f ${itag}+bestaudio/best`
      } else {
        // 기본: 최고 품질 비디오 + 최고 품질 오디오
        formatOptions = '-f bestvideo+bestaudio/best'
      }

      // 최종 명령어: 오디오를 확실하게 포함하고, 오디오 코덱 지정
      const command = `yt-dlp ${formatOptions} --merge-output-format mp4 --audio-quality 0 -o "${outputPath}" "${url}"`
      console.log('Executing command:', command)

      // yt-dlp 실행
      const { exec } = require('child_process')
      const download = exec(command)

      let stderr = ''
      download.stderr.on('data', (data) => {
        stderr += data.toString()
        console.error(`yt-dlp stderr: ${data}`)
      })

      let stdout = ''
      download.stdout.on('data', (data) => {
        stdout += data.toString()
        console.log(`yt-dlp stdout: ${data}`)
      })

      download.on('close', (code) => {
        console.log(`yt-dlp process exited with code ${code}`)

        if (code !== 0) {
          console.error('yt-dlp error details:', stderr)
          return res.status(500).json({ error: 'Download failed', details: stderr })
        }

        // 파일이 있는지 확인
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath)
          console.log(`File size: ${stats.size} bytes`)

          if (stats.size === 0) {
            fs.unlinkSync(outputPath)
            return res.status(500).json({ error: 'Downloaded file is empty' })
          }

          // 다운로드 완료 후 ffmpeg로 오디오 검사 (선택사항)
          try {
            ffmpeg.ffprobe(outputPath, (err, metadata) => {
              if (err) {
                console.error('ffprobe error:', err)
              } else {
                // 오디오 스트림이 있는지 검사
                const hasAudioStream = metadata.streams.some(
                  (stream) => stream.codec_type === 'audio',
                )
                console.log(`File has audio stream: ${hasAudioStream}`)

                if (!hasAudioStream) {
                  console.warn('Warning: Downloaded file does not have an audio stream')
                }
              }
            })
          } catch (probeErr) {
            console.error('Error checking audio stream:', probeErr)
          }

          // 다운로드 완료 후 파일 스트리밍
          res.setHeader('Content-Type', 'video/mp4')
          res.setHeader('Content-Disposition', `attachment; filename=${safeFilename}.mp4`)
          res.setHeader('Content-Length', stats.size)

          const fileStream = fs.createReadStream(outputPath)
          fileStream.pipe(res)

          // 파일 전송 완료 후 임시 파일 삭제
          fileStream.on('end', () => {
            fs.unlink(outputPath, (err) => {
              if (err) console.error('Error deleting temp file:', err)
            })
          })

          // 에러 처리
          fileStream.on('error', (err) => {
            console.error('File stream error:', err)
            res.status(500).end()
            fs.unlink(outputPath, () => {})
          })
        } else {
          res.status(500).json({ error: 'Downloaded file not found' })
        }
      })
    } catch (err) {
      console.error('Download Error:', err)
      res.status(500).json({ error: 'Failed to process download request' })
    }
  } catch (error) {
    console.error('Error in download endpoint:', error)
    res.status(500).json({ error: 'Failed to process download request' })
  }
})

// 오디오 다운로드 엔드포인트 추가
app.post('/api/download/youtube/audio', async (req, res) => {
  try {
    const { url } = req.body
    if (!url) {
      return res.status(400).json({ error: 'URL is required' })
    }

    // 임시 파일 저장 디렉토리 확인
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true })
    }

    try {
      // 고유 ID 생성
      const timestamp = Date.now()
      const randomStr = Math.random().toString(36).substring(2, 8)
      const safeFilename = `youtube_audio_${timestamp}_${randomStr}`
      const outputPath = path.join(downloadDir, `${safeFilename}.mp3`)

      // yt-dlp 명령어 구성 (오디오 품질 개선)
      const command = `yt-dlp -f bestaudio --extract-audio --audio-format mp3 --audio-quality 0 --postprocessor-args "-ar 44100" -o "${outputPath}" "${url}"`
      console.log('Executing audio command:', command)

      // yt-dlp 실행
      const { exec } = require('child_process')
      const download = exec(command)

      let stderr = ''
      download.stderr.on('data', (data) => {
        stderr += data.toString()
        console.error(`yt-dlp stderr: ${data}`)
      })

      let stdout = ''
      download.stdout.on('data', (data) => {
        stdout += data.toString()
        console.log(`yt-dlp stdout: ${data}`)
      })

      download.on('close', (code) => {
        console.log(`yt-dlp process exited with code ${code}`)

        if (code !== 0) {
          console.error('yt-dlp error details:', stderr)
          return res.status(500).json({ error: 'Audio download failed', details: stderr })
        }

        // 파일이 있는지 확인
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath)
          console.log(`Audio file size: ${stats.size} bytes`)

          if (stats.size === 0) {
            fs.unlinkSync(outputPath)
            return res.status(500).json({ error: 'Downloaded audio file is empty' })
          }

          // 다운로드 완료 후 파일 스트리밍
          res.setHeader('Content-Type', 'audio/mp3')
          res.setHeader('Content-Disposition', `attachment; filename=${safeFilename}.mp3`)
          res.setHeader('Content-Length', stats.size)

          const fileStream = fs.createReadStream(outputPath)
          fileStream.pipe(res)

          // 파일 전송 완료 후 임시 파일 삭제
          fileStream.on('end', () => {
            fs.unlink(outputPath, (err) => {
              if (err) console.error('Error deleting temp audio file:', err)
            })
          })

          // 에러 처리
          fileStream.on('error', (err) => {
            console.error('File stream error:', err)
            res.status(500).end()
            fs.unlink(outputPath, () => {})
          })
        } else {
          res.status(500).json({ error: 'Downloaded audio file not found' })
        }
      })
    } catch (err) {
      console.error('Audio Download Error:', err)
      res.status(500).json({ error: 'Failed to process audio download request' })
    }
  } catch (error) {
    console.error('Error in audio download endpoint:', error)
    res.status(500).json({ error: 'Failed to process audio download request' })
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
          .on('error', reject)
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
