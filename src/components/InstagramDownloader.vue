<template>
  <div class="instagram-downloader">
    <h2>Instagram Video Downloader</h2>

    <div class="input-container">
      <el-input
        v-model="url"
        placeholder="Enter Instagram URL"
        :disabled="loading"
        size="large"
        clearable
      >
        <template #prefix>
          <el-icon><VideoCamera /></el-icon>
        </template>
      </el-input>

      <el-button type="primary" @click="getVideoInfo" :loading="loading" size="large">
        Get Information
      </el-button>
    </div>

    <!-- Video information display -->
    <div v-if="videoInfo" class="video-info">
      <h3>Instagram Content</h3>
      <img :src="videoInfo.thumbnail" alt="Thumbnail" class="thumbnail" />

      <div class="download-options">
        <!-- Video download options -->
        <div class="format-selector">
          <el-select v-model="selectedFormat" placeholder="Select Resolution" size="large">
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
            Download Video
          </el-button>
        </div>

        <!-- Audio download button -->
        <div class="audio-download">
          <el-button
            type="primary"
            @click="handleAudioDownload"
            :loading="downloadingAudio"
            size="large"
          >
            Download Audio Only (MP3)
          </el-button>
        </div>
      </div>
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <!-- Loading popup addition -->
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

// Loading popup state management
const showLoadingPopup = ref(false)
const loadingTitle = ref('Processing...')
const loadingMessage = ref('Please wait a moment')
const loadingProgress = ref(0)
const loadingCancelable = ref(true)

// Progress state interval ID
let progressInterval = null

// Progress state simulation start
const startProgressSimulation = (action) => {
  showLoadingPopup.value = true
  loadingProgress.value = 0

  if (action === 'info') {
    loadingTitle.value = 'Getting Instagram Content Information'
    loadingMessage.value = 'Loading content information from Instagram...'
    // Information retrieval is quick
    simulateProgress(80, 300)
  } else if (action === 'video') {
    loadingTitle.value = 'Video Download'
    loadingMessage.value = 'Downloading video from Instagram...'
    // Video download progresses slowly
    simulateProgress(95, 400)
  } else if (action === 'audio') {
    loadingTitle.value = 'Audio Download'
    loadingMessage.value = 'Extracting audio from Instagram...'
    // Audio download progresses at medium speed
    simulateProgress(90, 350)
  }
}

// Progress state simulation
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

// Loading completion handler
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

// Loading cancellation handler
const handleCancelLoading = () => {
  showLoadingPopup.value = false
  clearInterval(progressInterval)
  loadingProgress.value = 0
  loading.value = false
  downloading.value = false
  downloadingAudio.value = false
}

// Video format calculation
const videoFormats = computed(() => {
  if (!videoInfo.value || !videoInfo.value.formats || videoInfo.value.formats.length === 0)
    return []

  // Use formats provided by the server
  return videoInfo.value.formats
})

const getVideoInfo = async () => {
  if (!url.value) {
    error.value = 'Please enter a URL'
    return
  }

  loading.value = true
  error.value = ''

  // Loading popup display
  startProgressSimulation('info')

  try {
    const response = await axios.post('/api/instagram/info', { url: url.value })
    videoInfo.value = response.data

    // Select the first format (highest quality)
    if (videoInfo.value.formats && videoInfo.value.formats.length > 0) {
      selectedFormat.value = videoInfo.value.formats[0].url
    }

    // Loading completion
    completeLoading(true)
  } catch (err) {
    console.error('Error:', err)
    error.value = 'Failed to retrieve video information'

    // Loading failure
    completeLoading(false)
  } finally {
    loading.value = false
  }
}

const handleVideoDownload = async () => {
  if (!selectedFormat.value) {
    error.value = 'Please select a resolution'
    return
  }

  downloading.value = true
  error.value = ''

  // Loading popup display
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

    // Download completion notification
    loadingProgress.value = 100
    loadingMessage.value = 'Download complete! Saving file...'

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

      // Loading completion
      completeLoading(true)
    }, 500)
  } catch (err) {
    console.error('Download error:', err)
    error.value = 'An error occurred during download'

    // Loading failure
    completeLoading(false)
  } finally {
    downloading.value = false
  }
}

const handleAudioDownload = async () => {
  if (!videoInfo.value) {
    error.value = 'Please get URL information first'
    return
  }

  downloadingAudio.value = true
  error.value = ''

  // Loading popup display
  startProgressSimulation('audio')

  try {
    const response = await axios.post(
      '/api/download/instagram/audio',
      { url: url.value },
      { responseType: 'blob' },
    )

    // Download completion notification
    loadingProgress.value = 100
    loadingMessage.value = 'Download complete! Saving file...'

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

      // Loading completion
      completeLoading(true)
    }, 500)
  } catch (err) {
    console.error('Audio download error:', err)
    error.value = 'An error occurred during audio download'

    // Loading failure
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
