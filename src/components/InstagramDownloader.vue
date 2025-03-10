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
        <!-- 비디오 다운로드 버튼 -->
        <el-button type="success" @click="handleVideoDownload" :loading="downloading" size="large">
          비디오 다운로드
        </el-button>

        <!-- 오디오 다운로드 버튼 -->
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

    <div v-if="error" class="error-message">
      {{ error }}
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { VideoCamera } from '@element-plus/icons-vue'
import axios from 'axios'

const url = ref('')
const loading = ref(false)
const downloading = ref(false)
const downloadingAudio = ref(false)
const error = ref('')
const videoInfo = ref(null)

const getVideoInfo = async () => {
  if (!url.value) {
    error.value = 'URL을 입력해주세요'
    return
  }

  loading.value = true
  error.value = ''

  try {
    const response = await axios.post('/api/instagram/info', { url: url.value })
    videoInfo.value = response.data
  } catch (err) {
    console.error('Error:', err)
    error.value = '비디오 정보를 가져오는데 실패했습니다'
  } finally {
    loading.value = false
  }
}

const handleVideoDownload = async () => {
  if (!videoInfo.value) {
    error.value = '먼저 URL 정보를 가져와주세요'
    return
  }

  downloading.value = true
  error.value = ''

  try {
    const response = await axios.post(
      '/api/download/instagram/video',
      { url: url.value },
      { responseType: 'blob' },
    )

    const blob = new Blob([response.data], { type: 'video/mp4' })
    const downloadUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = 'instagram_video.mp4'
    document.body.appendChild(link)
    link.click()
    window.URL.revokeObjectURL(downloadUrl)
    document.body.removeChild(link)
  } catch (err) {
    console.error('Download error:', err)
    error.value = '다운로드 중 오류가 발생했습니다'
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

  try {
    const response = await axios.post(
      '/api/download/instagram/audio',
      { url: url.value },
      { responseType: 'blob' },
    )

    const blob = new Blob([response.data], { type: 'audio/mp3' })
    const downloadUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = 'instagram_audio.mp3'
    document.body.appendChild(link)
    link.click()
    window.URL.revokeObjectURL(downloadUrl)
    document.body.removeChild(link)
  } catch (err) {
    console.error('Audio download error:', err)
    error.value = '오디오 다운로드 중 오류가 발생했습니다'
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
