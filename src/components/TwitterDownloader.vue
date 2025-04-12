<template>
  <div class="twitter-downloader">
    <h2>Twitter Video Downloader</h2>
    <div class="input-group">
      <input
        v-model="url"
        type="text"
        placeholder="Enter Twitter URL"
        :disabled="loading"
        @keyup.enter="getVideoInfo"
      />
      <button @click="getVideoInfo" :disabled="loading" class="info-button">Get Information</button>
    </div>

    <div v-if="error" class="error">{{ error }}</div>

    <div v-if="videoInfo" class="video-info">
      <img :src="videoInfo.thumbnail" alt="Thumbnail" class="thumbnail" />
      <div class="info-text">
        <h3>Twitter Content</h3>
        <h2>{{ videoInfo.title || 'Twitter Video' }}</h2>
        <div class="format-selector">
          <label for="format">Select Format:</label>
          <select v-model="selectedFormat" id="format">
            <option v-for="format in videoInfo.formats" :key="format.url" :value="format">
              {{ formatLabel(format) }}
            </option>
          </select>
        </div>
        <button @click="handleDownload" :disabled="downloading" class="download-button">
          Download Video
        </button>
      </div>
    </div>

    <LoadingPopup
      :visible="showLoadingPopup"
      :title="loadingTitle"
      :message="loadingMessage"
      :progress="loadingProgress"
      :cancelable="loadingCancelable"
      @cancel="handleCancel"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import axios from 'axios'
import LoadingPopup from './LoadingPopup.vue'

const url = ref('')
const loading = ref(false)
const downloading = ref(false)
const error = ref('')
const videoInfo = ref(null)
const selectedFormat = ref(null)

// Loading popup state
const showLoadingPopup = ref(false)
const loadingTitle = ref('Processing...')
const loadingMessage = ref('Please wait a moment')
const loadingProgress = ref(0)
const loadingCancelable = ref(true)
let progressInterval = null

// Progress simulation function
const simulateProgress = (startValue, endValue, duration) => {
  clearInterval(progressInterval)
  loadingProgress.value = startValue

  const step = (endValue - startValue) / (duration / 100)
  progressInterval = setInterval(() => {
    loadingProgress.value += step
    if (loadingProgress.value >= endValue) {
      loadingProgress.value = endValue
      clearInterval(progressInterval)
    }
  }, 100)
}

// Loading completion handler
const completeLoading = () => {
  clearInterval(progressInterval)
  loadingProgress.value = 100
  setTimeout(() => {
    showLoadingPopup.value = false
    loadingProgress.value = 0
  }, 500)
}

// Cancel handler
const handleCancel = () => {
  clearInterval(progressInterval)
  loadingProgress.value = 0
  showLoadingPopup.value = false

  if (loading.value) {
    loading.value = false
  }

  if (downloading.value) {
    downloading.value = false
  }
}

const formatLabel = (format) => {
  if (!format) return 'Unknown'
  return `${format.height}p (${Math.round((format.filesize / 1024 / 1024) * 100) / 100} MB)`
}

const getVideoInfo = async () => {
  if (!url.value) {
    error.value = 'Please enter a URL'
    return
  }

  try {
    error.value = ''
    loading.value = true
    videoInfo.value = null

    // Show loading popup
    showLoadingPopup.value = true
    loadingTitle.value = 'Getting Twitter Content Information'
    loadingMessage.value = 'Loading content information from Twitter...'
    loadingCancelable.value = true
    simulateProgress(0, 90, 3000)

    const response = await axios.post('/api/twitter/info', { url: url.value })
    videoInfo.value = response.data

    if (videoInfo.value && videoInfo.value.formats && videoInfo.value.formats.length > 0) {
      // Select highest resolution format by default
      const sortedFormats = [...videoInfo.value.formats].sort((a, b) => b.height - a.height)
      selectedFormat.value = sortedFormats[0]
    }

    completeLoading()
  } catch (err) {
    error.value =
      'Failed to retrieve video information: ' + (err.response?.data?.error || err.message)
    showLoadingPopup.value = false
  } finally {
    loading.value = false
  }
}

const handleDownload = async () => {
  if (!selectedFormat.value) {
    error.value = 'Please select a resolution'
    return
  }

  try {
    error.value = ''
    downloading.value = true

    // Show loading popup
    showLoadingPopup.value = true
    loadingTitle.value = 'Video Download'
    loadingMessage.value = 'Downloading video from Twitter...'
    loadingCancelable.value = false
    simulateProgress(0, 95, 5000)

    const response = await axios({
      url: selectedFormat.value.url,
      method: 'GET',
      responseType: 'blob',
    })

    const blob = new Blob([response.data], { type: 'video/mp4' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.style.display = 'none'
    a.href = url
    a.download = `twitter_video_${Date.now()}.mp4`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)

    loadingMessage.value = 'Download complete! Saving file...'

    completeLoading()
  } catch (err) {
    error.value = 'An error occurred during download: ' + (err.response?.data?.error || err.message)
    showLoadingPopup.value = false
  } finally {
    downloading.value = false
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
