<template>
  <div class="instagram-downloader">
    <h2>Instagram 비디오 다운로더</h2>

    <div class="input-container">
      <el-input
        v-model="url"
        placeholder="Instagram URL을 입력해주세요"
        :disabled="loading"
        size="large"
        clearable
      >
        <template #prefix>
          <el-icon><VideoCamera /></el-icon>
        </template>
      </el-input>

      <el-button type="primary" @click="getVideoInfo" :loading="loading" size="large">
        정보 가져오기
      </el-button>
    </div>

    <!-- 비디오 정보 표시 -->
    <div v-if="videoInfo" class="video-info">
      <h3>Instagram 콘텐츠</h3>
      <img :src="videoInfo.thumbnail" alt="썸네일" class="thumbnail" />

      <div class="download-options">
        <!-- 비디오 다운로드 옵션 -->
        <div class="format-selector">
          <el-select v-model="selectedFormat" placeholder="해상도 선택" size="large">
            <el-option
              v-for="format in videoFormats"
              :key="format.quality"
              :label="format.quality"
              :value="format.url"
            />
          </el-select>

          <el-button
            type="success"
            @click="handleVideoDownload"
            :loading="downloading"
            size="large"
          >
            비디오 다운로드
          </el-button>
        </div>

        <!-- 오디오 다운로드 버튼 -->
        <div class="audio-download">
          <el-button
            type="primary"
            @click="handleAudioDownload"
            :loading="downloadingAudio"
            size="large"
          >
            오디오만 다운로드 (MP3)
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
const loadingTitle = ref('처리 중...')
const loadingMessage = ref('잠시만 기다려주세요')
const loadingProgress = ref(0)
const loadingCancelable = ref(true)

// 진행 상태 인터벌 ID
let progressInterval = null

// 진행 상태 시뮬레이션 시작
const startProgressSimulation = (action) => {
  showLoadingPopup.value = true
  loadingProgress.value = 0

  if (action === 'info') {
    loadingTitle.value = '인스타그램 콘텐츠 정보 가져오기'
    loadingMessage.value = '인스타그램에서 콘텐츠 정보를 불러오는 중입니다...'
    // 정보 가져오기는 빠르게 진행
    simulateProgress(80, 300)
  } else if (action === 'video') {
    loadingTitle.value = '동영상 다운로드'
    loadingMessage.value = '인스타그램에서 동영상을 다운로드하는 중입니다...'
    // 비디오 다운로드는 천천히 진행
    simulateProgress(95, 400)
  } else if (action === 'audio') {
    loadingTitle.value = '오디오 다운로드'
    loadingMessage.value = '인스타그램에서 오디오를 추출하는 중입니다...'
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

// 비디오 포맷 계산
const videoFormats = computed(() => {
  if (!videoInfo.value || !videoInfo.value.formats || videoInfo.value.formats.length === 0)
    return []

  // 서버에서 제공하는 포맷 사용
  return videoInfo.value.formats
})

const getVideoInfo = async () => {
  if (!url.value) {
    error.value = 'URL을 입력해주세요'
    return
  }

  loading.value = true
  error.value = ''

  // 로딩 팝업 표시
  startProgressSimulation('info')

  try {
    const response = await axios.post('/api/instagram/info', { url: url.value })
    videoInfo.value = response.data

    // 첫 번째 포맷(최고 품질) 선택
    if (videoInfo.value.formats && videoInfo.value.formats.length > 0) {
      selectedFormat.value = videoInfo.value.formats[0].url
    }

    // 로딩 완료
    completeLoading(true)
  } catch (err) {
    console.error('Error:', err)
    error.value = '비디오 정보를 가져오는데 실패했습니다'

    // 로딩 실패
    completeLoading(false)
  } finally {
    loading.value = false
  }
}

const handleVideoDownload = async () => {
  if (!selectedFormat.value) {
    error.value = '해상도를 선택해주세요'
    return
  }

  downloading.value = true
  error.value = ''

  // 로딩 팝업 표시
  startProgressSimulation('video')

  try {
    const response = await axios.post(
      '/api/download/instagram/video',
      {
        url: url.value,
        videoUrl: selectedFormat.value,
      },
      { responseType: 'blob' },
    )

    // 다운로드 완료 표시
    loadingProgress.value = 100
    loadingMessage.value = '다운로드 완료! 파일을 저장합니다...'

    setTimeout(() => {
      const blob = new Blob([response.data], { type: 'video/mp4' })
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = 'instagram_video.mp4'
      document.body.appendChild(link)
      link.click()
      window.URL.revokeObjectURL(downloadUrl)
      document.body.removeChild(link)

      // 로딩 완료
      completeLoading(true)
    }, 500)
  } catch (err) {
    console.error('Download error:', err)
    error.value = '다운로드 중 오류가 발생했습니다'

    // 로딩 실패
    completeLoading(false)
  } finally {
    downloading.value = false
  }
}

const handleAudioDownload = async () => {
  if (!videoInfo.value) {
    error.value = '먼저 URL 정보를 가져와주세요'
    return
  }

  downloadingAudio.value = true
  error.value = ''

  // 로딩 팝업 표시
  startProgressSimulation('audio')

  try {
    const response = await axios.post(
      '/api/download/instagram/audio',
      { url: url.value },
      { responseType: 'blob' },
    )

    // 다운로드 완료 표시
    loadingProgress.value = 100
    loadingMessage.value = '다운로드 완료! 파일을 저장합니다...'

    setTimeout(() => {
      const blob = new Blob([response.data], { type: 'audio/mp3' })
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = 'instagram_audio.mp3'
      document.body.appendChild(link)
      link.click()
      window.URL.revokeObjectURL(downloadUrl)
      document.body.removeChild(link)

      // 로딩 완료
      completeLoading(true)
    }, 500)
  } catch (err) {
    console.error('Audio download error:', err)
    error.value = '오디오 다운로드 중 오류가 발생했습니다'

    // 로딩 실패
    completeLoading(false)
  } finally {
    downloadingAudio.value = false
  }
}
</script>

<style scoped>
.instagram-downloader {
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
