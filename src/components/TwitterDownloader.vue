<template>
  <div class="twitter-downloader">
    <h2>Twitter (X) Video Downloader</h2>

    <div class="input-container">
      <el-input
        v-model="url"
        placeholder="Enter Twitter (X) URL"
        :disabled="loading"
        @keyup.enter="getVideoInfo"
      />
      <el-button type="primary" @click="getVideoInfo" :loading="loading" :disabled="!url">
        Get Information
      </el-button>
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <div v-if="videoInfo" class="video-info">
      <div class="video-preview">
        <img v-if="videoInfo.thumbnail" :src="videoInfo.thumbnail" alt="Video thumbnail" />
        <video v-if="videoInfo.formats && videoInfo.formats.length > 0" controls width="320">
          <source
            :src="videoInfo.formats[0].url"
            :type="'video/' + getVideoType(videoInfo.formats[0].url)"
          />
        </video>
      </div>
      <div class="video-details">
        <h3>{{ videoInfo.description || 'Twitter Video' }}</h3>
        <div class="format-selector">
          <label for="format-select">Select format:</label>
          <select id="format-select" v-model="selectedFormat">
            <option v-for="(format, index) in sortedFormats" :key="index" :value="format">
              {{ formatLabel(format) }}
            </option>
          </select>
        </div>
        <div class="download-buttons">
          <el-button type="success" @click="handleDownload" :loading="downloading">
            Download Video
          </el-button>
          <el-button type="info" @click="handleAudioDownload" :loading="audioDownloading">
            Download Audio
          </el-button>
        </div>
      </div>
    </div>

    <LoadingPopup
      :visible="showLoadingPopup"
      :title="loadingTitle"
      :message="loadingMessage"
      :progress="loadingProgress"
      :cancelable="loadingCancelable"
      @cancel="handleLoadingCancel"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import LoadingPopup from './LoadingPopup.vue'

const url = ref('')
const loading = ref(false)
const downloading = ref(false)
const audioDownloading = ref(false)
const error = ref(null)
const videoInfo = ref(null)
const selectedFormat = ref(null)

// 로딩 팝업 상태
const showLoadingPopup = ref(false)
const loadingTitle = ref('')
const loadingMessage = ref('')
const loadingProgress = ref(0)
const loadingCancelable = ref(true)
const loadingCancelled = ref(false)
const progressInterval = ref(null)

// 정렬된 포맷 (고화질 우선)
const sortedFormats = computed(() => {
  if (!videoInfo.value || !videoInfo.value.formats) return []

  return [...videoInfo.value.formats].sort((a, b) => {
    // m3u8 형식은 항상 맨 위에 배치
    if (a.url.includes('.m3u8') && !b.url.includes('.m3u8')) return -1
    if (!a.url.includes('.m3u8') && b.url.includes('.m3u8')) return 1

    // 해상도로 정렬 (높은 것이 우선)
    const resA = a.resolution ? parseInt(a.resolution.replace(/[^0-9]/g, '')) : 0
    const resB = b.resolution ? parseInt(b.resolution.replace(/[^0-9]/g, '')) : 0

    return resB - resA
  })
})

// 비디오 형식에 따른 라벨 생성
const formatLabel = (format) => {
  let label = format.resolution || 'Unknown'

  if (format.url.includes('.m3u8') || format.type === 'm3u8') {
    label += ' (HLS Stream)'
  }

  if (format.filesize) {
    const sizeMB = (format.filesize / (1024 * 1024)).toFixed(2)
    label += ` - ${sizeMB} MB`
  }

  return label
}

// 비디오 타입 확인 (mp4, webm 등)
const getVideoType = (url) => {
  if (url.includes('.mp4')) return 'mp4'
  if (url.includes('.webm')) return 'webm'
  if (url.includes('.m3u8')) return 'application/x-mpegURL'
  return 'mp4' // 기본값
}

// 진행 상태 시뮬레이션 시작
const startProgressSimulation = (action, duration = 10000) => {
  loadingCancelled.value = false
  loadingProgress.value = 0

  // 이전 인터벌 정리
  if (progressInterval.value) {
    clearInterval(progressInterval.value)
  }

  // 새 인터벌 시작
  progressInterval.value = setInterval(() => {
    if (loadingCancelled.value) {
      clearInterval(progressInterval.value)
      return
    }

    // 작업에 따라 다른 진행률 증가 속도 사용
    let increment = 3
    if (action === 'info') increment = 5
    if (action === 'download') increment = 2
    if (action === 'audio') increment = 1.5

    loadingProgress.value += increment

    // 90%에서 정지 (실제 완료 시 100%로 설정)
    if (loadingProgress.value >= 90) {
      loadingProgress.value = 90
      clearInterval(progressInterval.value)
    }
  }, duration / 30)
}

// 로딩 완료 처리
const completeLoading = () => {
  loadingProgress.value = 100
  if (progressInterval.value) {
    clearInterval(progressInterval.value)
  }

  // 잠시 후 로딩 팝업 닫기
  setTimeout(() => {
    showLoadingPopup.value = false
    loadingProgress.value = 0
  }, 500)
}

// 로딩 취소 처리
const handleLoadingCancel = () => {
  loadingCancelled.value = true
  showLoadingPopup.value = false
  loading.value = false
  downloading.value = false
  audioDownloading.value = false

  if (progressInterval.value) {
    clearInterval(progressInterval.value)
  }
}

// 비디오 정보 가져오기
const getVideoInfo = async () => {
  if (!url.value) {
    error.value = 'Please enter a Twitter URL'
    return
  }

  error.value = null
  loading.value = true

  // 로딩 팝업 표시
  showLoadingPopup.value = true
  loadingTitle.value = 'Fetching Video Information'
  loadingMessage.value = 'Loading video data from Twitter...'
  loadingCancelable.value = true
  startProgressSimulation('info')

  try {
    const response = await axios.post('/api/twitter/info', { url: url.value })
    videoInfo.value = response.data

    // 선택된 포맷이 없거나 유효하지 않은 경우 첫 번째 포맷 선택
    if (!selectedFormat.value || !videoInfo.value.formats.includes(selectedFormat.value)) {
      selectedFormat.value = sortedFormats.value[0]
    }

    completeLoading()
  } catch (err) {
    error.value = err.response?.data?.error || 'Failed to fetch video information'
    handleLoadingCancel()
  } finally {
    loading.value = false
  }
}

// 비디오 다운로드
const handleDownload = async () => {
  if (!selectedFormat.value) {
    error.value = 'Please select a format'
    return
  }

  error.value = null
  downloading.value = true

  // 로딩 팝업 표시
  showLoadingPopup.value = true
  loadingTitle.value = 'Downloading Video'
  loadingMessage.value = 'Preparing video for download...'
  loadingCancelable.value = true
  startProgressSimulation('download')

  try {
    const isHls = selectedFormat.value.url.includes('.m3u8') || selectedFormat.value.type === 'm3u8'

    const response = await axios({
      method: 'post',
      url: '/api/download/twitter',
      data: {
        url: url.value,
        videoUrl: selectedFormat.value.url,
        isHls: isHls,
      },
      responseType: 'blob',
    })

    completeLoading()

    // 파일 다운로드
    const contentType = response.headers['content-type']
    const blob = new Blob([response.data], { type: contentType })
    const link = document.createElement('a')

    link.href = URL.createObjectURL(blob)

    // 파일명 설정
    const filename = isHls
      ? `twitter_video_stream_${Date.now()}.mp4`
      : `twitter_video_${Date.now()}.mp4`

    link.download = filename
    link.click()

    URL.revokeObjectURL(link.href)
  } catch (err) {
    error.value = err.response?.data?.error || 'Failed to download video'
    handleLoadingCancel()
  } finally {
    downloading.value = false
  }
}

// 오디오 다운로드
const handleAudioDownload = async () => {
  if (!selectedFormat.value) {
    error.value = 'Please select a format'
    return
  }

  error.value = null
  audioDownloading.value = true

  // 로딩 팝업 표시
  showLoadingPopup.value = true
  loadingTitle.value = 'Extracting Audio'
  loadingMessage.value = 'Converting video to MP3 format...'
  loadingCancelable.value = true
  startProgressSimulation('audio', 20000) // 오디오 변환은 더 오래 걸림

  try {
    const isHls = selectedFormat.value.url.includes('.m3u8') || selectedFormat.value.type === 'm3u8'

    // 로딩 메시지 업데이트
    if (isHls) {
      loadingMessage.value = 'Extracting audio from HLS stream...'
    }

    const response = await axios({
      method: 'post',
      url: '/api/download/twitter/audio',
      data: {
        url: url.value,
        videoUrl: selectedFormat.value.url,
        isHls: isHls,
      },
      responseType: 'blob',
    })

    completeLoading()

    // 파일 다운로드
    const contentType = 'audio/mp3'
    const blob = new Blob([response.data], { type: contentType })
    const link = document.createElement('a')

    link.href = URL.createObjectURL(blob)
    // 파일명에 HLS 표시 추가
    const filename = isHls
      ? `twitter_audio_stream_${Date.now()}.mp3`
      : `twitter_audio_${Date.now()}.mp3`
    link.download = filename
    link.click()

    URL.revokeObjectURL(link.href)
  } catch (err) {
    error.value = err.response?.data?.error || 'Failed to extract audio'
    handleLoadingCancel()
  } finally {
    audioDownloading.value = false
  }
}

onMounted(() => {
  // URL 파라미터 체크
  const urlParams = new URLSearchParams(window.location.search)
  const initialUrl = urlParams.get('url')

  if (initialUrl) {
    url.value = initialUrl
    getVideoInfo()
  }
})
</script>

<style scoped>
.twitter-downloader {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

h2 {
  text-align: center;
  margin-bottom: 20px;
  color: #1da1f2; /* Twitter Blue */
}

.input-container {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.error-message {
  color: #dc3545;
  margin: 10px 0;
  padding: 10px;
  background-color: #f8d7da;
  border-radius: 4px;
}

.video-info {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-top: 20px;
  padding: 20px;
  border: 1px solid #e1e8ed;
  border-radius: 8px;
  background-color: #f5f8fa;
}

@media (min-width: 768px) {
  .video-info {
    flex-direction: row;
  }

  .video-preview {
    flex: 0 0 320px;
  }

  .video-details {
    flex: 1;
    padding-left: 20px;
  }
}

.video-preview img,
.video-preview video {
  max-width: 100%;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.video-details h3 {
  margin-top: 0;
  margin-bottom: 15px;
  color: #14171a;
}

.format-selector {
  margin-bottom: 20px;
}

.format-selector select {
  width: 100%;
  padding: 8px;
  border: 1px solid #ccd6dd;
  border-radius: 4px;
  margin-top: 5px;
}

.download-buttons {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

@media (max-width: 767px) {
  .download-buttons {
    flex-direction: column;
  }
}
</style>
