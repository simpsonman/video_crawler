<template>
  <div class="twitter-downloader">
    <h2>X (Twitter) Video Downloader</h2>

    <div class="input-container">
      <el-input
        v-model="url"
        placeholder="Enter your X (Twitter) URL"
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
      <!-- <img :src="videoInfo.thumbnail" alt="썸네일" class="thumbnail" /> -->

      <div class="download-options">
        <!-- 비디오 다운로드 옵션 -->
        <div class="format-selector">
          <el-select v-model="selectedFormat" placeholder="Select a resolution" size="large">
            <el-option
              v-for="format in videoInfo.formats"
              :key="format.quality"
              :label="format.quality"
              :value="format.url"
            />
          </el-select>

          <el-button type="success" @click="handleDownload" :loading="downloading" size="large">
            Download the video
          </el-button>
        </div>

        <!-- 오디오 다운로드 버튼 -->
        <!-- <div class="audio-download">
          <el-button
            type="primary"
            @click="handleAudioDownload"
            :loading="downloadingAudio"
            size="large"
          >
            오디오만 다운로드 (MP3)
          </el-button>
        </div> -->
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
import { ref } from 'vue'
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
    loadingTitle.value = 'X (Twitter) Video Information'
    loadingMessage.value = 'Getting video information from X...'
    // 정보 가져오기는 빠르게 진행
    simulateProgress(80, 300)
  } else if (action === 'video') {
    loadingTitle.value = 'Video Download'
    loadingMessage.value = 'Downloading video from X...'
    // 비디오 다운로드는 천천히 진행
    simulateProgress(95, 400)
  } else if (action === 'audio') {
    loadingTitle.value = 'Audio Download'
    loadingMessage.value = 'Extracting audio from X...'
    // 오디오 다운로드는 중간 속도로 진행
    simulateProgress(90, 350)
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

const getVideoInfo = async () => {
  if (!url.value) {
    error.value = 'Enter your X (Twitter) URL'
    return
  }

  loading.value = true
  error.value = ''

  // 로딩 팝업 표시
  startProgressSimulation('info')

  try {
    const response = await axios.post('/api/twitter/info', { url: url.value })
    videoInfo.value = response.data
    selectedFormat.value = videoInfo.value.formats[0]?.url // 최고 품질 기본 선택

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
    error.value = 'Select a resolution'
    return
  }

  downloading.value = true
  error.value = ''

  // 로딩 팝업 표시
  startProgressSimulation('video')

  try {
    const response = await axios.post(
      '/api/download/twitter',
      {
        url: url.value,
        videoUrl: selectedFormat.value,
      },
      {
        responseType: 'blob',
      },
    )

    // 다운로드 완료 표시
    loadingProgress.value = 100
    loadingMessage.value = 'Download completed! Please save the file...'

    setTimeout(() => {
      const blob = new Blob([response.data], { type: 'video/mp4' })
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = 'twitter_video.mp4'
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

const handleAudioDownload = async () => {
  if (!url.value) {
    error.value = 'Enter your X (Twitter) URL'
    return
  }

  downloadingAudio.value = true
  error.value = ''

  // 로딩 팝업 표시
  startProgressSimulation('audio')

  try {
    const response = await axios.post(
      '/api/download/twitter/audio',
      { url: url.value },
      { responseType: 'blob' },
    )

    // 다운로드 완료 표시
    loadingProgress.value = 100
    loadingMessage.value = 'Download completed! Please save the file...'

    setTimeout(() => {
      const blob = new Blob([response.data], { type: 'audio/mp3' })
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = 'twitter_audio.mp3'
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
</script>

<style scoped>
.twitter-downloader {
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
