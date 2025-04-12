<template>
  <div class="youtube-downloader">
    <h2>YouTube Video Downloader</h2>

    <div class="input-container">
      <el-input
        v-model="url"
        placeholder="Enter your YouTube URL"
        :disabled="loading"
        size="large"
        clearable
      >
        <template #prefix>
          <el-icon><VideoCamera /></el-icon>
        </template>
      </el-input>

      <el-button type="primary" @click="getVideoInfo" :loading="loading" size="large">
        Get information
      </el-button>
    </div>

    <!-- 비디오 정보 표시 -->
    <div v-if="videoInfo" class="video-info">
      <h3>{{ videoInfo.title }}</h3>
      <img :src="videoInfo.thumbnail" alt="Thumbnail" class="thumbnail" />

      <div v-if="isLiveStream" class="live-indicator">
        <el-tag type="danger">LIVE</el-tag>
        <p class="live-notice">
          Live stream downloads are available only for premium subscribers. Please upgrade your
          account to access this feature.
        </p>
        <el-button type="warning" size="large" @click="showPremiumInfo">
          Upgrade to Premium
        </el-button>
      </div>

      <div class="download-options">
        <!-- 비디오 다운로드 옵션 -->
        <div class="format-selector">
          <el-select
            v-model="selectedFormat"
            placeholder="Select a resolution"
            size="large"
            :disabled="isLiveStream"
          >
            <el-option
              v-for="format in videoInfo.formats"
              :key="format.itag"
              :label="formatLabel(format)"
              :value="format.itag"
            />
          </el-select>

          <el-button
            type="success"
            @click="handleDownload"
            :loading="downloading"
            :disabled="isLiveStream"
            size="large"
          >
            Download the video
          </el-button>
        </div>

        <!-- 오디오 다운로드 버튼 (라이브 스트리밍이 아닐 때만 표시) -->
        <div v-if="!isLiveStream" class="audio-download">
          <el-button
            type="primary"
            @click="handleAudioDownload"
            :loading="downloadingAudio"
            size="large"
          >
            Download the audio
          </el-button>
        </div>
      </div>
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <!-- 로딩 팝업 추가 -->
    <LoadingPopup
      :visible="showLoadingPopup"
      :title="loadingTitle"
      :message="loadingMessage"
      :progress="loadingProgress"
      :showCancelButton="loadingCancelable"
      @cancel="handleCancelLoading"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { VideoCamera } from '@element-plus/icons-vue'
import axios from 'axios'
import LoadingPopup from './LoadingPopup.vue'

const url = ref('')
const loading = ref(false)
const downloading = ref(false)
const downloadingAudio = ref(false)
const error = ref('')
const videoInfo = ref(null)
const selectedFormat = ref(null)

// 로딩 팝업 상태 관리
const showLoadingPopup = ref(false)
const loadingTitle = ref('Processing...')
const loadingMessage = ref('Please wait a moment')
const loadingProgress = ref(0)
const loadingCancelable = ref(true)

// 진행 상태 인터벌 ID
let progressInterval = null

// 진행 상태 시뮬레이션 시작
const startProgressSimulation = (action) => {
  showLoadingPopup.value = true
  loadingProgress.value = 0

  if (action === 'info') {
    loadingTitle.value = 'Get video information'
    loadingMessage.value = 'Getting video information from YouTube...'
    // 정보 가져오기는 빠르게 진행
    simulateProgress(80, 300)
  } else if (action === 'video') {
    loadingTitle.value = 'Downloading video'
    loadingMessage.value = 'Downloading video from YouTube...'
    // 비디오 다운로드는 천천히 진행
    simulateProgress(95, 500)
  } else if (action === 'audio') {
    loadingTitle.value = 'Audio download'
    loadingMessage.value = 'Extracting audio from YouTube...'
    // 오디오 다운로드는 중간 속도로 진행
    simulateProgress(90, 400)
  }
}

// 진행 상태 시뮬레이션
const simulateProgress = (targetProgress, interval) => {
  clearInterval(progressInterval)

  progressInterval = setInterval(() => {
    if (loadingProgress.value < targetProgress) {
      loadingProgress.value += 1
    } else {
      clearInterval(progressInterval)
    }
  }, interval)
}

// 로딩 완료 처리
const completeLoading = (success = true) => {
  clearInterval(progressInterval)

  if (success) {
    loadingProgress.value = 100
    setTimeout(() => {
      showLoadingPopup.value = false
      loadingProgress.value = 0
    }, 500)
  } else {
    showLoadingPopup.value = false
    loadingProgress.value = 0
  }
}

// 로딩 취소 처리
const handleCancelLoading = () => {
  showLoadingPopup.value = false
  clearInterval(progressInterval)
  loadingProgress.value = 0
  loading.value = false
  downloading.value = false
  downloadingAudio.value = false
}

// 라이브 스트리밍 여부 확인
const isLiveStream = computed(() => {
  return videoInfo.value?.isLive || false
})

// 포맷 라벨 표시 함수
const formatLabel = (format) => {
  if (isLiveStream.value) {
    // 라이브 스트리밍인 경우
    return format.quality || 'Premium Only'
  } else {
    // 일반 비디오인 경우
    return `${format.quality} (${format.fps}fps)`
  }
}

const getVideoInfo = async () => {
  if (!url.value) {
    error.value = 'Please enter the URL'
    return
  }

  loading.value = true
  error.value = ''

  // 로딩 팝업 표시
  startProgressSimulation('info')

  try {
    const response = await axios.post('/api/youtube/info', { url: url.value })

    if (!response || !response.data) {
      throw new Error('Invalid response from server')
    }

    videoInfo.value = response.data

    // formats가 존재하고 배열인지 확인
    if (Array.isArray(videoInfo.value.formats) && videoInfo.value.formats.length > 0) {
      selectedFormat.value = videoInfo.value.formats[0]?.itag // 최고 품질 기본 선택
    } else {
      console.warn('No formats available or formats is not an array')
    }

    // 로딩 완료
    completeLoading(true)
  } catch (err) {
    console.error('Error:', err)
    error.value = 'Failed to get video information'

    // 로딩 실패
    completeLoading(false)
  } finally {
    loading.value = false
  }
}

const handleDownload = async () => {
  if (!selectedFormat.value) {
    error.value = 'Please select a resolution'
    return
  }

  // 라이브 스트리밍 체크 추가
  if (isLiveStream.value) {
    error.value = 'Live stream downloads are only available for premium subscribers'
    showPremiumInfo()
    return
  }

  downloading.value = true
  error.value = ''

  // 로딩 팝업 표시
  startProgressSimulation('video')

  try {
    const response = await axios.post(
      '/api/download/youtube',
      {
        url: url.value,
        itag: selectedFormat.value,
      },
      {
        responseType: 'blob',
      },
    )

    // 다운로드 완료 표시
    loadingProgress.value = 100
    loadingMessage.value = 'Download completed! Please save the file...'

    setTimeout(() => {
      if (!response.data) {
        throw new Error('No data received from server')
      }

      const blob = new Blob([response.data], { type: 'video/mp4' })
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl

      // 파일명 설정 (안전하게 처리)
      const safeTitle = videoInfo.value?.title || 'youtube_video'
      const fileName = isLiveStream.value ? `${safeTitle}_segment.mp4` : `${safeTitle}.mp4`

      link.download = fileName
      document.body.appendChild(link)
      link.click()
      window.URL.revokeObjectURL(downloadUrl)
      document.body.removeChild(link)

      // 로딩 완료
      completeLoading(true)
    }, 500)
  } catch (err) {
    console.error('Download error:', err)
    error.value = 'An error occurred during download'

    // 로딩 실패
    completeLoading(false)
  } finally {
    downloading.value = false
  }
}

// 오디오 다운로드 핸들러
const handleAudioDownload = async () => {
  if (!url.value) {
    error.value = 'Please enter the URL'
    return
  }

  // 라이브 스트리밍인 경우 오디오 다운로드 불가
  if (isLiveStream.value) {
    error.value = 'Audio-only download is not available for live streams'
    return
  }

  downloadingAudio.value = true
  error.value = ''

  // 로딩 팝업 표시
  startProgressSimulation('audio')

  try {
    const response = await axios.post(
      '/api/download/youtube/audio',
      { url: url.value },
      { responseType: 'blob' },
    )

    // 다운로드 완료 표시
    loadingProgress.value = 100
    loadingMessage.value = 'Download completed! Please save the file...'

    setTimeout(() => {
      if (!response.data) {
        throw new Error('No data received from server')
      }

      const blob = new Blob([response.data], { type: 'audio/mp3' })
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl

      // 안전한 파일명 처리
      const safeTitle = videoInfo.value?.title || 'youtube_audio'
      link.download = `${safeTitle}.mp3`

      document.body.appendChild(link)
      link.click()
      window.URL.revokeObjectURL(downloadUrl)
      document.body.removeChild(link)

      // 로딩 완료
      completeLoading(true)
    }, 500)
  } catch (err) {
    console.error('Audio download error:', err)
    error.value = 'An error occurred during audio download'

    // 로딩 실패
    completeLoading(false)
  } finally {
    downloadingAudio.value = false
  }
}

// 프리미엄 정보 표시 함수 추가
const showPremiumInfo = () => {
  // 이 부분에서 결제 페이지나 안내 모달을 표시할 수 있습니다
  error.value =
    'Premium subscription required for live stream downloads. Please contact us for more information.'
}
</script>

<style scoped>
.youtube-downloader {
  padding: 2rem 1rem;
}

h2 {
  font-size: 1.5rem;
  color: #2c3e50;
  margin-bottom: 2rem;
  text-align: center;
}

.input-container {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.video-info {
  margin-top: 2rem;
  text-align: center;
}

.thumbnail {
  max-width: 320px;
  margin: 1rem auto;
  border-radius: 8px;
}

.live-indicator {
  margin: 1rem 0;
}

.live-notice {
  margin-top: 0.5rem;
  font-size: 0.9rem;
  color: #666;
}

.download-options {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
  margin-top: 1rem;
}

.format-selector {
  display: flex;
  gap: 1rem;
  justify-content: center;
  width: 100%;
}

.audio-download {
  width: 100%;
  display: flex;
  justify-content: center;
}

.error-message {
  color: #f56c6c;
  text-align: center;
  margin-top: 1rem;
}

:deep(.el-input__wrapper) {
  padding-right: 1rem;
}

:deep(.el-input__prefix) {
  margin-right: 0.5rem;
}
</style>
